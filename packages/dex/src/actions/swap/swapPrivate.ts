import {
  executeContract,
  writeContract,
  type Client,
  type InputRequest,
  type TransactionInput,
} from '@veil/core'
import { getPool } from '../reads/getPool.js'
import { getSlot } from '../reads/getSlot.js'
import { nextBlindedIdentity, viewKeyToScalar } from '../../blinded-identity.js'
import { selectTokenRecord } from '../../records.js'
import { resolveSwapParams, getDeadline, generateSwapNonce } from '../../helpers/params.js'
import { blindingFactorIssueRequest, blindedAddressIssueRequest } from '../../wallet-requests.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Parameters for {@link swapPrivate}.
 *
 * @property poolKey Pool key field literal to trade against.
 * @property tokenInId Token id (field literal) being sold. Must be one of
 *   the pool's two tokens.
 * @property amountIn Raw atomic amount to sell (u128). Must respect the
 *   token's no-dust rule (see `dustScale`).
 * @property slippageBps Slippage tolerance in basis points. Defaults to 50
 *   (0.5%).
 * @property expectedOut Quoted output amount (e.g. from the indexer's
 *   `/route`). Optional — without it a spot estimate is used, which ignores
 *   price impact and fees.
 * @property sqrtPriceLimit Explicit Q64 price bound. Defaults to the
 *   directional extreme (rely on `amount_out_min`).
 * @property deadlineOffsetBlocks Blocks until the request expires. Defaults
 *   to 100.
 * @property nonce Explicit u64 nonce. Defaults to crypto-random — override
 *   only for reproducible ids (e.g. tests).
 * @property tokenInProgram Program holding the caller's token records (a
 *   wrapper program or the registry). Required on the local-signer path
 *   unless `tokenRecord` is given; unused when `tokenRecord` is provided.
 * @property tokenRecord Explicit record input: a record plaintext literal
 *   (any local signer), or a `record` InputRequest (wallet signers, who know
 *   their record grants). REQUIRED for wallet accounts — the client cannot
 *   guess a wallet's record shape.
 * @property blindedIdentity Explicit pre-derived identity literals (any
 *   local signer that derives by its own means). Defaults to deriving from
 *   the local account's view key, or wallet-side `derived` requests for
 *   wallet accounts.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap program override. Defaults to `DEFAULT_PROGRAM`
 *   (the live shield_swap deployment).
 */
export type SwapPrivateParameters = {
  poolKey: string
  tokenInId: string
  amountIn: bigint
  slippageBps?: number
  expectedOut?: bigint
  sqrtPriceLimit?: bigint
  deadlineOffsetBlocks?: number
  nonce?: bigint
  tokenInProgram?: string
  tokenRecord?: string | InputRequest
  blindedIdentity?: { blindingFactor: string; blindedAddress: string }
  imports?: Record<string, string>
  program?: string
}

/**
 * The serializable thread between a private swap's two transactions.
 *
 * `swapPrivate` returns it; `claimSwapOutputPrivate` consumes it. Plain JSON
 * on purpose — persist it (disk, DB) so a claim can happen after a crash or
 * from another process.
 *
 * @property swapId Swap id field literal (the request transition's first
 *   output). Present immediately on the local-signer path; on the wallet
 *   path it becomes known once the wallet's transaction confirms — resolve
 *   it from the transaction before claiming.
 * @property blindingFactor Secret field literal proving ownership at claim
 *   time. Present only on the local-signer path — a wallet keeps it private
 *   and re-derives it from `blindedAddress` at claim time. Treat like a key.
 * @property blindedAddress The public single-use address the swap recorded.
 *   Present immediately on the local-signer path; on the wallet path the
 *   wallet fills the slot, so recover it post-confirmation from the
 *   transition's public inputs (or the indexer's `swap.recipient`) before
 *   claiming.
 * @property tokenInId Token id (field literal) that was sold.
 * @property tokenOutId Token id (field literal) that was bought.
 * @property poolKey Pool the swap executed against.
 * @property amountIn Raw atomic amount sold (u128).
 * @property transactionId The request transaction's id.
 * @property program The shield_swap program the swap targets.
 */
export interface SwapHandle {
  swapId?: string
  blindingFactor?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  poolKey: string
  amountIn: bigint
  transactionId: string
  program: string
}

export type SwapPrivateReturnType = SwapHandle

/**
 * Requests a private swap — phase one of the two-transaction lifecycle.
 *
 * Resolves the intent against live pool state, obtains a single-use blinded
 * identity and a token record (see the two signer paths below), submits the
 * `swap_private` transition, and returns a serializable {@link SwapHandle}.
 * The chain computes the outcome at finalize; read it with `getSwapOutput`
 * and collect it with `claimSwapOutputPrivate`.
 *
 * Signer paths:
 * - **Local account** — derives the blinding identity from the account's view
 *   key (loads the optional WASM SDK), selects an unspent record via the
 *   client's record provider, proves locally, waits for confirmation, and
 *   returns a handle with `swapId`/`blindedAddress` already filled.
 * - **Wallet account** — emits wallet-derived requests for the blinding
 *   slots (`tokenRecord` must be provided); the wallet proves and returns a
 *   transaction id. `swapId` and `blindedAddress` become recoverable from
 *   the confirmed transaction.
 *
 * Hits the network: pool reads, deadline read, record scan, and the
 * transaction itself. Signs, and on the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The swap intent and optional overrides.
 * @returns The swap handle — persist it; the claim consumes it.
 * @throws When the pool does not exist; when the intent violates the
 *   contract's rules (dust, bad slippage, foreign token — see
 *   `resolveSwapParams`); when no record covers the amount; when a wallet
 *   account is used without `tokenRecord`; and on transport/proving errors.
 *
 * @example
 * const handle = await swapPrivate(client, {
 *   poolKey, tokenInId, amountIn: 10n ** 18n, tokenInProgram: 'ethx_5a095e.aleo',
 * })
 * // …await finalize, then:
 * // const out = await getSwapOutput(client, { swapId: handle.swapId! })
 */
export async function swapPrivate(client: Client, params: SwapPrivateParameters): Promise<SwapPrivateReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  // Live pool state drives direction, dust validation, and the price bound.
  const pool = await getPool(client, { poolKey: params.poolKey, program })
  if (!pool) throw new Error(`Pool ${params.poolKey} does not exist on ${program}`)
  const slot = await getSlot(client, { poolKey: params.poolKey, program })
  if (!slot) throw new Error(`Pool ${params.poolKey} has no slot state on ${program}`)

  const resolved = resolveSwapParams({
    pool,
    slot,
    tokenInId: params.tokenInId,
    amountIn: params.amountIn,
    slippageBps: params.slippageBps ?? 50,
    expectedOut: params.expectedOut,
    sqrtPriceLimit: params.sqrtPriceLimit,
  })

  const deadline = await getDeadline(client, { offsetBlocks: params.deadlineOffsetBlocks })
  const nonce = params.nonce ?? generateSwapNonce()

  const account = (client as { account?: { type: string; address: string; viewKey?: string } }).account
  if (!account) throw new Error('swapPrivate requires a wallet client with an account')
  const isLocal = account.type === 'local'

  // Shared tail of the positional input list (everything after the three
  // signer-dependent slots): pool, direction, amounts, bounds, timing, tokens.
  const tail: string[] = [
    params.poolKey,
    String(resolved.zeroForOne),
    `${params.amountIn}u128`,
    `${resolved.amountOutMin}u128`,
    `${resolved.sqrtPriceLimit}u128`,
    `${nonce}u64`,
    `${deadline}u32`,
    pool.token0,
    pool.token1,
  ]

  if (isLocal) {
    // Local signer: literals only — derive the identity and select a record.
    const identity =
      params.blindedIdentity ??
      (await nextBlindedIdentity(client, {
        viewKeyScalar: await viewKeyToScalar(account.viewKey!),
        signer: account.address,
        program,
      }))

    let recordInput: string
    if (typeof params.tokenRecord === 'string') {
      recordInput = params.tokenRecord
    } else if (params.tokenRecord) {
      throw new Error('Local accounts cannot use InputRequests — pass a record plaintext literal instead')
    } else {
      if (!params.tokenInProgram) {
        throw new Error('tokenInProgram is required to auto-select a record (or pass tokenRecord explicitly)')
      }
      const picked = await selectTokenRecord(client, {
        program: params.tokenInProgram,
        minAmount: params.amountIn,
        tokenId: params.tokenInId,
      })
      recordInput = picked.record.recordPlaintext
    }

    const result = await executeContract(client, {
      program,
      function: 'swap_private',
      imports: params.imports,
      inputs: [recordInput, identity.blindingFactor, identity.blindedAddress, ...tail],
    })

    // The transition's first output is the public swap id.
    const swapId = result.outputs[0]
    if (!swapId?.endsWith('field')) {
      throw new Error(`Unexpected swap_private output shape: ${JSON.stringify(result.outputs)}`)
    }

    return {
      swapId,
      blindingFactor: identity.blindingFactor,
      blindedAddress: identity.blindedAddress,
      tokenInId: params.tokenInId,
      tokenOutId: resolved.tokenOutId,
      poolKey: params.poolKey,
      amountIn: params.amountIn,
      transactionId: result.transactionId,
      program,
    }
  }

  // Wallet signer: the wallet fulfils the blinding slots (and the record —
  // the dapp supplies its record request or granted plaintext).
  if (params.tokenRecord === undefined) {
    throw new Error(
      'Wallet accounts must provide tokenRecord (a record InputRequest or granted plaintext) — ' +
        'the client cannot guess the wallet record shape',
    )
  }
  const blindingInputs: [TransactionInput, TransactionInput] = params.blindedIdentity
    ? [params.blindedIdentity.blindingFactor, params.blindedIdentity.blindedAddress]
    : [blindingFactorIssueRequest(program), blindedAddressIssueRequest(program)]

  const transactionId = await writeContract(client, {
    program,
    function: 'swap_private',
      imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs: [params.tokenRecord, ...blindingInputs, ...tail],
  })

  return {
    // swapId/blindedAddress are wallet-filled — recover them from the
    // confirmed transaction (or the indexer) before claiming.
    swapId: undefined,
    blindingFactor: params.blindedIdentity?.blindingFactor,
    blindedAddress: params.blindedIdentity?.blindedAddress,
    tokenInId: params.tokenInId,
    tokenOutId: resolved.tokenOutId,
    poolKey: params.poolKey,
    amountIn: params.amountIn,
    transactionId,
    program,
  }
}
