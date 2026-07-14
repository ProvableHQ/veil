import {
  executeContract,
  writeContract,
  type Client,
  type InputRequest,
  type TransactionInput,
} from '@provablehq/veil-core'
import { nextBlindedIdentity, viewKeyToScalar } from '../../utils/blinding/identity.js'
import { resolveTokenRecord } from '../../utils/records.js'
import { requireAccount, requirePool, requireSlot } from '../../utils/guards.js'
import {
  resolveMultiHopParams,
  getDeadline,
  generateSwapNonce,
  formatSwapHopSlots,
  type SwapHopInput,
} from '../../utils/params.js'
import { blindingFactorIssueRequest, blindedAddressIssueRequest } from '../../utils/blinding/requests.js'
import { tryLoadSdk } from '../../utils/sdk.js'
import { deriveMultiHopSwapId } from '../../utils/keys.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Parameters for {@link swapMultiHop}.
 *
 * @property poolKeys The 2–3 pool keys in route order (the contract asserts
 *   `2 <= hop_count <= 3`; a single hop uses `swap`). Get routes from the
 *   API's `/route`.
 * @property tokenInId Token id (field literal) being sold. Must be in the
 *   first pool; each hop's direction is resolved by walking the token path.
 * @property amountIn Raw atomic amount to sell (u128). Must respect the
 *   input token's no-dust rule.
 * @property slippageBps Slippage tolerance in basis points, applied once to
 *   the route's expected final output. Defaults to 50 (0.5%).
 * @property expectedOut Quoted final output (e.g. from the API's `/route`).
 *   Optional — without it a chained spot estimate is used, which ignores
 *   price impact and fees on every hop.
 * @property sqrtPriceLimits Explicit per-hop Q64 price bounds. Defaults each
 *   hop to its directional extreme (rely on `amount_out_min`).
 * @property deadlineOffsetBlocks Blocks until the request expires. Defaults
 *   to 100.
 * @property nonce Explicit u64 nonce. Defaults to crypto-random — override
 *   only for reproducible ids (e.g. tests).
 * @property tokenInProgram Program holding the caller's input-token records.
 *   Required on the local-signer path unless `tokenRecord` is given.
 * @property tokenRecord Explicit record input: a record plaintext literal
 *   (any local signer), or a `record` InputRequest (wallet signers).
 *   REQUIRED for wallet accounts.
 * @property blindedIdentity Explicit pre-derived identity literals. Defaults
 *   to deriving from the local account's view key, or wallet-side `derived`
 *   requests for wallet accounts.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`) — pass the involved token programs' sources
 *   when proving locally or via a service that requires them.
 * @property program shield_swap program override. Defaults to `DEFAULT_PROGRAM`.
 */
export type SwapMultiHopParameters = {
  poolKeys: string[]
  tokenInId: string
  amountIn: bigint
  slippageBps?: number
  expectedOut?: bigint
  sqrtPriceLimits?: bigint[]
  deadlineOffsetBlocks?: number
  nonce?: bigint
  tokenInProgram?: string
  tokenRecord?: string | InputRequest
  blindedIdentity?: { blindingFactor: string; blindedAddress: string }
  imports?: Record<string, string>
  program?: string
}

/**
 * The serializable thread between a multi-hop swap's two transactions.
 *
 * `swapMultiHop` returns it; `claimMultiHopOutput` consumes it. Plain JSON
 * on purpose — persist it (disk, DB) so a claim can happen after a crash or
 * from another process. Carries the full id preimage (`hops`,
 * `amountOutMin`, `nonce`, `deadline`), so a wallet-path id is computable
 * with `deriveMultiHopSwapId` once the blinded address is known.
 *
 * @property swapId Swap id field literal (the request transition's first
 *   output). Present immediately on the local-signer path; on the wallet
 *   path it is derived locally when the caller supplied `blindedIdentity`
 *   and `@provablehq/sdk` is installed, and `undefined` otherwise.
 * @property blindingFactor Secret field literal proving ownership at claim
 *   time. Present only on the local-signer path. Treat like a key.
 * @property blindedAddress The public single-use address the swap recorded.
 *   Present immediately on the local-signer path; on the wallet path recover
 *   it post-confirmation from the transition's public inputs.
 * @property tokenInId Token id (field literal) that was sold.
 * @property tokenOutId Token id (field literal) the route pays out.
 * @property poolKeys The route's pool keys, in hop order.
 * @property hops The resolved hops (direction + price bound), in hop order.
 * @property amountIn Raw atomic amount sold (u128).
 * @property amountOutMin The submitted minimum final output (u128).
 * @property nonce The submitted u64 nonce.
 * @property deadline The submitted absolute block height (u32).
 * @property transactionId The request transaction's id.
 * @property program The shield_swap program the swap targets.
 */
export interface MultiHopSwapHandle {
  swapId?: string
  blindingFactor?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  poolKeys: string[]
  hops: SwapHopInput[]
  amountIn: bigint
  amountOutMin: bigint
  nonce: bigint
  deadline: number
  transactionId: string
  program: string
}

/** The {@link MultiHopSwapHandle} a multi-hop request resolves to — persist it; the claim consumes it. */
export type SwapMultiHopReturnType = MultiHopSwapHandle

/**
 * Requests a private multi-hop swap — phase one of the two-transaction
 * lifecycle.
 *
 * Resolves the route against live pool state (hop directions from the token
 * path, dust and bound validation), obtains a single-use blinded identity
 * and a token record, submits `swap_multi_hop`, and returns a serializable
 * {@link MultiHopSwapHandle}. The chain computes the outcome at finalize;
 * read it with `getSwapOutput` and collect it with `claimMultiHopOutput`.
 *
 * Signer paths mirror `swap`:
 * - **Local account** — derives the blinding identity from the view key,
 *   auto-selects an unspent record, proves locally, and returns a handle
 *   with `swapId`/`blindedAddress` already filled.
 * - **Wallet account** — emits wallet-derived requests for the blinding
 *   slots (`tokenRecord` must be provided); the wallet proves and returns a
 *   transaction id.
 *
 * Hits the network: per-hop pool/slot reads, a deadline read, a record scan
 * (local), and the transaction itself. Signs, and on the local path proves
 * locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The route intent and optional overrides.
 * @returns The multi-hop handle — persist it; the claim consumes it.
 * @throws When a pool does not exist; when the token path does not connect;
 *   when the intent violates the contract's rules (hop count, dust, bad
 *   bounds); when no record covers the amount; when a wallet account is used
 *   without `tokenRecord`; and on transport/proving errors.
 *
 * @example
 * const handle = await swapMultiHop(client, {
 *   poolKeys: [ethUsdcPool, usdcAleoPool],
 *   tokenInId: ethTokenId,
 *   amountIn: 10n ** 18n,
 *   tokenInProgram: 'ethx_5a095e.aleo',
 * })
 * // …await finalize, then:
 * // const res = await claimMultiHopOutput(client, { handle })
 */
export async function swapMultiHop(client: Client, params: SwapMultiHopParameters): Promise<SwapMultiHopReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  // Live per-hop pool state drives direction, dust validation, and bounds.
  const pools = await Promise.all(params.poolKeys.map((k) => requirePool(client, k, program)))
  const slots = await Promise.all(params.poolKeys.map((k) => requireSlot(client, k, program)))

  const resolved = resolveMultiHopParams({
    pools,
    slots,
    poolKeys: params.poolKeys,
    tokenInId: params.tokenInId,
    amountIn: params.amountIn,
    slippageBps: params.slippageBps ?? 50,
    expectedOut: params.expectedOut,
    sqrtPriceLimits: params.sqrtPriceLimits,
  })

  const deadline = await getDeadline(client, { offsetBlocks: params.deadlineOffsetBlocks })
  const nonce = params.nonce ?? generateSwapNonce()

  const account = requireAccount(client, 'swapMultiHop')
  const isLocal = account.type === 'local'

  // Shared tail after the three signer-dependent slots: tokens, amounts, the
  // three hop structs (zero-padded), hop count, nonce, deadline — the
  // deployed ABI's exact order.
  const hopLiterals = formatSwapHopSlots(resolved.hops)
  const tail: string[] = [
    params.tokenInId,
    resolved.tokenOutId,
    `${params.amountIn}u128`,
    `${resolved.amountOutMin}u128`,
    ...hopLiterals,
    `${resolved.hops.length}u8`,
    `${nonce}u64`,
    `${deadline}u32`,
  ]

  const handleBase = {
    tokenInId: params.tokenInId,
    tokenOutId: resolved.tokenOutId,
    poolKeys: params.poolKeys,
    hops: resolved.hops,
    amountIn: params.amountIn,
    amountOutMin: resolved.amountOutMin,
    nonce,
    deadline,
    program,
  }

  if (isLocal) {
    // Local signer: literals only — derive the identity and select a record.
    const identity =
      params.blindedIdentity ??
      (await nextBlindedIdentity(client, {
        viewKeyScalar: await viewKeyToScalar(account.viewKey!),
        signer: account.address,
        program,
      }))

    const recordInput = await resolveTokenRecord(client, {
      tokenRecord: params.tokenRecord,
      tokenInProgram: params.tokenInProgram,
      tokenId: params.tokenInId,
      minAmount: params.amountIn,
    })

    const result = await executeContract(client, {
      program,
      function: 'swap_multi_hop',
      imports: params.imports,
      inputs: [identity.blindingFactor, identity.blindedAddress, recordInput, ...tail],
    })

    // The transition's first output is the public swap id.
    const swapId = result.outputs[0]
    if (!swapId?.endsWith('field')) {
      throw new Error(`Unexpected swap_multi_hop output shape: ${JSON.stringify(result.outputs)}`)
    }
    return {
      ...handleBase,
      swapId,
      blindingFactor: identity.blindingFactor,
      blindedAddress: identity.blindedAddress,
      transactionId: result.transactionId,
    }
  }

  // Wallet signer: the wallet fulfils the blinding slots; the dapp supplies
  // its record request or granted plaintext.
  if (params.tokenRecord === undefined) {
    throw new Error(
      'Wallet accounts must provide tokenRecord (a record InputRequest or granted plaintext) — ' +
        'the client cannot guess the wallet record shape',
    )
  }
  const blindingInputs: [TransactionInput, TransactionInput] = params.blindedIdentity
    ? [params.blindedIdentity.blindingFactor, params.blindedIdentity.blindedAddress]
    : [blindingFactorIssueRequest(program), blindedAddressIssueRequest(program)]

  // Best-effort id: derivable only when the caller supplied the blinded
  // identity and the WASM peer is present. A derivation fault degrades to
  // undefined rather than blocking a submittable transaction.
  let swapId: string | undefined
  if (params.blindedIdentity && (await tryLoadSdk())) {
    swapId = await deriveMultiHopSwapId({
      tokenInId: params.tokenInId,
      tokenOutId: resolved.tokenOutId,
      amountIn: params.amountIn,
      amountOutMin: resolved.amountOutMin,
      blindedAddress: params.blindedIdentity.blindedAddress,
      hops: resolved.hops,
      nonce,
      deadline,
    }).catch(() => undefined)
  }

  const transactionId = await writeContract(client, {
    program,
    function: 'swap_multi_hop',
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs: [...blindingInputs, params.tokenRecord, ...tail],
  })

  return {
    ...handleBase,
    swapId,
    blindingFactor: params.blindedIdentity?.blindingFactor,
    blindedAddress: params.blindedIdentity?.blindedAddress,
    transactionId,
  }
}
