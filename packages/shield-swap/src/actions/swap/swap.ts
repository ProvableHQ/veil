import {
  executeContract,
  writeContract,
  type Client,
  type InputRequest,
  type TransactionInput,
} from '@provablehq/veil-core'
import { reserveBlindedIdentity } from '../blinding/reserveBlindedIdentity.js'
import { recordSwapOrThrow } from '../../utils/blinding/tracking.js'
import type { BlindedIdentityStore } from '../../utils/blinding/store.js'
import { nextBlindedIdentity, viewKeyToScalar } from '../../utils/blinding/identity.js'
import { resolveTokenRecord } from '../../utils/records.js'
import { requireAccount, requirePool, requireSlot } from '../../utils/guards.js'
import { resolveSwapParams, getDeadline, generateSwapNonce } from '../../utils/params.js'
import { blindingFactorIssueRequest, blindedAddressIssueRequest } from '../../utils/blinding/requests.js'
import { resolveTokenRoute, tokenIdToProgram, type TokenRoute } from '../../utils/routing.js'
import { resolveProofPair, formatMerkleProofPair, type ProofProvider } from '../../utils/proofs.js'
import { formatU256Literal } from '../../utils/q128.js'
import { tryLoadSdk } from '../../utils/sdk.js'
import { deriveSwapId } from '../../utils/keys.js'
import { requireFieldOutput } from '../../utils/outputs.js'
import { SHIELD_SWAP, SHIELD_SWAP_ROUTER } from '../../constants.js'

/**
 * Parameters for {@link swap}.
 *
 * @property poolKey Pool key field literal to trade against.
 * @property tokenInId Token id (field literal) being sold. Must be one of
 *   the pool's two tokens. Wrapped-ness is resolved on chain — the caller
 *   never names wrapper programs; a wrapped input routes through
 *   `swap_from_wrapped` and spends the caller's UNDERLYING records.
 * @property amountIn Raw atomic amount to sell (u128), in native units.
 * @property slippageBps Slippage tolerance in basis points. Defaults to 50
 *   (0.5%).
 * @property expectedOut Quoted output amount (e.g. from the API's
 *   `/route`). Optional — without it a spot estimate is used, which ignores
 *   price impact and fees.
 * @property sqrtPriceLimit Explicit Q128.128 price bound. Defaults to the
 *   directional extreme (rely on `amount_out_min`).
 * @property deadlineOffsetBlocks Blocks until the request expires. Defaults
 *   to 100.
 * @property nonce Explicit u64 nonce. Defaults to crypto-random — override
 *   only for reproducible ids (e.g. tests).
 * @property tokenRecord Explicit record input: a record plaintext literal
 *   (any local signer), or a `record` InputRequest (wallet signers, who know
 *   their record grants). For a wrapped input this is the UNDERLYING asset's
 *   record (e.g. a credits record for wrapped ALEO). REQUIRED for wallet
 *   accounts — the client cannot guess a wallet's record shape.
 * @property blindedIdentity Explicit pre-derived identity literals (any
 *   local signer that derives by its own means). Defaults to deriving from
 *   the local account's view key, or wallet-side `derived` requests for
 *   wallet accounts.
 * @property route Pre-resolved input-token route — the offline/override
 *   escape hatch. Defaults to reading `from_wrapper_token_id` on chain
 *   (cached per process).
 * @property proofs Freezelist witness provider for populated freezelists.
 *   Defaults to the empty-tree witness, which the contracts accept while
 *   the lists are empty.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover dynamic callees
 *   statically — pass the involved token programs' sources when proving
 *   locally or via a service that requires them.
 * @property blindedIdentities Store that reserves the blinded identity and
 *   records the resulting handle. Supplied by `shieldSwapActions` when
 *   configured. With it, concurrent swaps from one account cannot collide on an
 *   identity and the swap is claimable from the store afterwards; without it the
 *   identity is derived by scanning the chain, which is safe in sequence only.
 *   Ignored when `blindedIdentity` is passed explicitly — an explicit identity
 *   means the caller is tracking it themselves — and on wallet accounts, which
 *   derive their own.
 * @property program Core AMM program override. Defaults to
 *   `shield_swap.aleo`.
 * @property routerProgram Swap router override for wrapped-input dispatch.
 *   Defaults to `shield_swap_router.aleo`.
 */
export type SwapParameters = {
  poolKey: string
  tokenInId: string
  amountIn: bigint
  slippageBps?: number
  expectedOut?: bigint
  sqrtPriceLimit?: bigint
  deadlineOffsetBlocks?: number
  nonce?: bigint
  tokenRecord?: string | InputRequest
  blindedIdentity?: { blindingFactor: string; blindedAddress: string }
  blindedIdentities?: BlindedIdentityStore
  route?: TokenRoute
  proofs?: ProofProvider
  imports?: Record<string, string>
  program?: string
  routerProgram?: string
}

/**
 * The serializable thread between a private swap's two transactions.
 *
 * `swap` returns it; `claimSwapOutput` consumes it. Plain JSON
 * on purpose — persist it (disk, DB) so a claim can happen after a crash or
 * from another process.
 *
 * @property swapId Swap id field literal (the request's public swap-id
 *   output). Present immediately on the local-signer path; on the wallet
 *   path it is derived locally when the caller supplied `blindedIdentity`
 *   and `@provablehq/sdk` is installed, and `undefined` otherwise — resolve
 *   it from the confirmed transaction, or compute it with `deriveSwapId`
 *   once the blinded address is known.
 * @property blindingFactor Secret field literal proving ownership at claim
 *   time. Present only on the local-signer path — a wallet keeps it private
 *   and re-derives it from `blindedAddress` at claim time. Treat like a key.
 * @property blindedAddress The public single-use address the swap recorded.
 *   Present immediately on the local-signer path; on the wallet path the
 *   wallet fills the slot, so recover it post-confirmation from the
 *   transition's public inputs (or the API's `swap.recipient`) before
 *   claiming.
 * @property tokenInId Token id (field literal) that was sold.
 * @property tokenOutId Token id (field literal) that was bought.
 * @property tokenInWrapped True when the input token routed through the
 *   swap router (spent underlying records). Informational — the claim
 *   re-resolves routes from the chain.
 * @property tokenOutWrapped True when the output token is a wrapper — its
 *   claim pays out the UNDERLYING asset via the router.
 * @property poolKey Pool the swap executed against.
 * @property amountIn Raw atomic amount sold (u128).
 * @property zeroForOne True when the swap sold the pool's token0 for token1.
 *   Filled by every new swap; optional so handles persisted before this
 *   field existed still parse.
 * @property sqrtPriceLimit The submitted Q128.128 price bound. Optional for
 *   the same persistence-compatibility reason.
 * @property nonce The submitted u64 nonce. With `zeroForOne`,
 *   `sqrtPriceLimit`, and the blinded address, it completes the `deriveSwapId`
 *   preimage — a wallet-path id is computable from the handle alone once the
 *   blinded address is known.
 * @property transactionId The request transaction's id.
 * @property program The core AMM program the swap targets (`swap_outputs`
 *   lives here even for router-submitted requests).
 */
export interface SwapHandle {
  swapId?: string
  blindingFactor?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  tokenInWrapped?: boolean
  tokenOutWrapped?: boolean
  poolKey: string
  amountIn: bigint
  zeroForOne?: boolean
  sqrtPriceLimit?: bigint
  nonce?: bigint
  transactionId: string
  program: string
}

/** The {@link SwapHandle} a swap request resolves to — persist it; the claim consumes it. */
export type SwapReturnType = SwapHandle

/**
 * Requests a private swap — phase one of the two-transaction lifecycle.
 *
 * Resolves the intent against live pool state, resolves the input token's
 * route (plain tokens call `swap` on the core AMM; wrapped tokens call
 * `swap_from_wrapped` on the router, spending the caller's underlying
 * records — wrappers stay invisible), obtains a single-use blinded identity
 * and a token record, submits the request, and returns a serializable
 * {@link SwapHandle}. The chain computes the outcome at finalize; read it
 * with `getSwapOutput` and collect it with `claimSwapOutput`.
 *
 * Signer paths:
 * - **Local account** — derives the blinding identity from the account's view
 *   key (loads the optional WASM SDK), selects an unspent record via the
 *   client's record provider, proves locally, waits for confirmation, and
 *   returns a handle with `swapId`/`blindedAddress` already filled.
 * - **Wallet account** — emits wallet-derived requests for the blinding
 *   slots (`tokenRecord` must be provided); the wallet proves and returns a
 *   transaction id. `swapId` fills immediately when the caller supplied
 *   `blindedIdentity` and `@provablehq/sdk` is installed; otherwise it and
 *   `blindedAddress` become recoverable from the confirmed transaction.
 *
 * Hits the network: pool reads, route reads (cached), deadline read, record
 * scan, and the transaction itself. Signs, and on the local path proves
 * locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The swap intent and optional overrides.
 * @returns The swap handle — persist it; the claim consumes it.
 * @throws When the pool does not exist; when the intent violates the
 *   contract's rules (bad slippage, foreign token, bad price bound — see
 *   `resolveSwapParams`); when a routed (wrapped-input) swap resolves to a
 *   zero `amount_out_min` (the router rejects it — supply `expectedOut` or
 *   lower the slippage); when no record covers the amount; when a wallet
 *   account is used without `tokenRecord`; and on transport/proving errors.
 *
 * @example
 * const handle = await swap(client, {
 *   poolKey, tokenInId, amountIn: 1_000_000_000n, expectedOut: quote.amount_out,
 * })
 * // …await finalize, then:
 * // const out = await getSwapOutput(client, { swapId: handle.swapId! })
 */
export async function swap(client: Client, params: SwapParameters): Promise<SwapReturnType> {
  const program = params.program ?? SHIELD_SWAP
  const routerProgram = params.routerProgram ?? SHIELD_SWAP_ROUTER

  // Live pool state drives direction and the price bound.
  const pool = await requirePool(client, params.poolKey, program)
  const slot = await requireSlot(client, params.poolKey, program)

  const resolved = resolveSwapParams({
    pool,
    slot,
    tokenInId: params.tokenInId,
    amountIn: params.amountIn,
    slippageBps: params.slippageBps ?? 50,
    expectedOut: params.expectedOut,
    sqrtPriceLimit: params.sqrtPriceLimit,
  })

  // Wrapped-ness decides the dispatch target and which records are spent;
  // the output route is captured for the handle so the claim's payout shape
  // is known up front.
  const route = await resolveTokenRoute(client, { tokenId: params.tokenInId, program, route: params.route })
  const outRoute = await resolveTokenRoute(client, { tokenId: resolved.tokenOutId, program })

  // The router transition asserts amount_out_min > 0; a zero minimum can
  // only revert after proving. Never inflate the caller's amounts silently.
  if (route.wrapped && resolved.amountOutMin <= 0n) {
    throw new Error(
      'Wrapped-input swaps route through the router, which requires amount_out_min > 0 — ' +
        'pass expectedOut (a quote) or a slippage tolerance that resolves to a positive minimum.',
    )
  }

  const deadline = await getDeadline(client, { offsetBlocks: params.deadlineOffsetBlocks })
  const nonce = params.nonce ?? generateSwapNonce()

  const account = requireAccount(client, 'swap')
  const isLocal = account.type === 'local'

  // Shared tail of the positional input list (everything after the
  // signer-dependent slots) — identical for `swap` and `swap_from_wrapped`.
  const tail: string[] = [
    params.poolKey,
    String(resolved.zeroForOne),
    `${params.amountIn}u128`,
    `${resolved.amountOutMin}u128`,
    formatU256Literal(resolved.sqrtPriceLimit),
    `${nonce}u64`,
    `${deadline}u32`,
    pool.token0,
    pool.token1,
  ]

  // Wrapped input: the deposit rides the wrapper's freezelist check, so the
  // sender proves non-inclusion (empty-tree witness while lists are empty).
  const senderProof = route.wrapped
    ? formatMerkleProofPair(
        await resolveProofPair(params.proofs, {
          list: 'wrapper',
          program: route.wrapperProgram,
          subject: account.address,
        }),
      )
    : undefined

  const handleBase = {
    tokenInId: params.tokenInId,
    tokenOutId: resolved.tokenOutId,
    tokenInWrapped: route.wrapped,
    tokenOutWrapped: outRoute.wrapped,
    poolKey: params.poolKey,
    amountIn: params.amountIn,
    zeroForOne: resolved.zeroForOne,
    sqrtPriceLimit: resolved.sqrtPriceLimit,
    nonce,
    program,
  }

  if (isLocal) {
    // Local signer: literals only — derive the identity and select a record.
    // The identity scope is the CORE program even for router submissions.
    // A store both picks the counter and remembers it, which is what makes two
    // concurrent swaps safe: reservations serialize, so they cannot derive the
    // same address and have the second revert on the uniqueness assert.
    const tracked = params.blindedIdentity === undefined ? params.blindedIdentities : undefined
    const identity =
      params.blindedIdentity ??
      (tracked
        ? await reserveBlindedIdentity(client, { store: tracked, program })
        : await nextBlindedIdentity(client, {
            viewKeyScalar: await viewKeyToScalar(account.viewKey!),
            signer: account.address,
            program,
          }))

    // Wrapped inputs spend the UNDERLYING asset's records; plain inputs
    // spend the token program's own records (the id decodes to the program).
    const recordInput = await resolveTokenRecord(client, {
      tokenRecord: params.tokenRecord,
      tokenInProgram: route.wrapped ? route.underlyingProgram : tokenIdToProgram(route.tokenId),
      tokenId: route.wrapped ? route.underlyingId : params.tokenInId,
      minAmount: params.amountIn,
    })

    const result = route.wrapped
      ? await executeContract(client, {
          program: routerProgram,
          function: 'swap_from_wrapped',
          imports: params.imports,
          inputs: [recordInput, senderProof!, identity.blindingFactor, identity.blindedAddress, ...tail],
        })
      : await executeContract(client, {
          program,
          function: 'swap',
          imports: params.imports,
          inputs: [recordInput, identity.blindingFactor, identity.blindedAddress, ...tail],
        })

    const swapId = requireFieldOutput(result.outputs, 'swap')

    const handle = {
      ...handleBase,
      swapId,
      blindingFactor: identity.blindingFactor,
      blindedAddress: identity.blindedAddress,
      transactionId: result.transactionId,
    }
    // After the submission, so the store never claims a swap the chain does not
    // have. A failure here surfaces rather than being swallowed: the swap id is
    // knowable now and unknowable later.
    if (tracked) await recordSwapOrThrow(tracked, handle)
    return handle
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

  // Best-effort id: derivable only when the caller supplied the blinded
  // identity (the wallet otherwise fills those slots) and the WASM peer is
  // present. A derivation fault (broken WASM asset, CSP, version skew)
  // degrades to undefined rather than blocking a submittable transaction;
  // the id then comes from the confirmed transaction, as without the peer.
  let swapId: string | undefined
  if (params.blindedIdentity && (await tryLoadSdk())) {
    swapId = await deriveSwapId({
      poolKey: params.poolKey,
      zeroForOne: resolved.zeroForOne,
      amountIn: params.amountIn,
      sqrtPriceLimit: resolved.sqrtPriceLimit,
      blindedAddress: params.blindedIdentity.blindedAddress,
      nonce,
    }).catch(() => undefined)
  }

  const transactionId = await writeContract(client, {
    program: route.wrapped ? routerProgram : program,
    function: route.wrapped ? 'swap_from_wrapped' : 'swap',
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs: route.wrapped
      ? [params.tokenRecord, senderProof!, ...blindingInputs, ...tail]
      : [params.tokenRecord, ...blindingInputs, ...tail],
  })

  return {
    ...handleBase,
    swapId,
    blindingFactor: params.blindedIdentity?.blindingFactor,
    blindedAddress: params.blindedIdentity?.blindedAddress,
    transactionId,
  }
}
