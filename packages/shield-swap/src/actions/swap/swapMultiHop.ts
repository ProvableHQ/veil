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
import { resolveTokenRoute, tokenIdToProgram, type TokenRoute } from '../../utils/routing.js'
import { resolveProofPair, formatMerkleProofPair, type ProofProvider } from '../../utils/proofs.js'
import { tryLoadSdk } from '../../utils/sdk.js'
import { deriveMultiHopSwapId } from '../../utils/keys.js'
import { SHIELD_SWAP, SHIELD_SWAP_ROUTER } from '../../constants.js'

/**
 * Parameters for {@link swapMultiHop}.
 *
 * @property poolKeys The 2–3 pool keys in route order (the contract asserts
 *   `2 <= hop_count <= 3`; a single hop uses `swap`). Get routes from the
 *   API's `/route`.
 * @property tokenInId Token id (field literal) being sold. Must be in the
 *   first pool; each hop's direction is resolved by walking the token path.
 *   Wrapped-ness is resolved on chain — a wrapped input routes through
 *   `swap_mh_from_wrapped` and spends the caller's UNDERLYING records.
 * @property amountIn Raw atomic amount to sell (u128), in native units.
 * @property slippageBps Slippage tolerance in basis points, applied once to
 *   the route's expected final output. Defaults to 50 (0.5%).
 * @property expectedOut Quoted final output (e.g. from the API's `/route`).
 *   Optional — without it a chained spot estimate is used, which ignores
 *   price impact and fees on every hop.
 * @property sqrtPriceLimits Explicit per-hop Q128.128 price bounds. Defaults
 *   each hop to its directional extreme (rely on `amount_out_min`).
 * @property deadlineOffsetBlocks Blocks until the request expires. Defaults
 *   to 100.
 * @property nonce Explicit u64 nonce. Defaults to crypto-random — override
 *   only for reproducible ids (e.g. tests).
 * @property tokenRecord Explicit record input: a record plaintext literal
 *   (any local signer), or a `record` InputRequest (wallet signers). For a
 *   wrapped input this is the UNDERLYING asset's record. REQUIRED for
 *   wallet accounts.
 * @property blindedIdentity Explicit pre-derived identity literals. Defaults
 *   to deriving from the local account's view key, or wallet-side `derived`
 *   requests for wallet accounts.
 * @property route Pre-resolved input-token route — the offline/override
 *   escape hatch. Defaults to reading `from_wrapper_token_id` on chain
 *   (cached per process).
 * @property proofs Freezelist witness provider for populated freezelists.
 *   Defaults to the empty-tree witness.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`) — pass the involved token programs' sources
 *   when proving locally or via a service that requires them.
 * @property program Core AMM program override. Defaults to
 *   `shield_swap.aleo`.
 * @property routerProgram Swap router override for wrapped-input dispatch.
 *   Defaults to `shield_swap_router.aleo`.
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
  tokenRecord?: string | InputRequest
  blindedIdentity?: { blindingFactor: string; blindedAddress: string }
  route?: TokenRoute
  proofs?: ProofProvider
  imports?: Record<string, string>
  program?: string
  routerProgram?: string
}

/**
 * The serializable thread between a multi-hop swap's two transactions.
 *
 * `swapMultiHop` returns it; `claimSwapOutput` consumes it. Plain JSON
 * on purpose — persist it (disk, DB) so a claim can happen after a crash or
 * from another process. Carries the full id preimage (`hops`,
 * `amountOutMin`, `nonce`, `deadline`), so a wallet-path id is computable
 * with `deriveMultiHopSwapId` once the blinded address is known.
 *
 * @property swapId Swap id field literal (the request's public swap-id
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
 * @property tokenInWrapped True when the input token routed through the
 *   swap router (spent underlying records). Informational — the claim
 *   re-resolves routes from the chain.
 * @property tokenOutWrapped True when the output token is a wrapper — its
 *   claim pays out the UNDERLYING asset via the router.
 * @property poolKeys The route's pool keys, in hop order.
 * @property hops The resolved hops (direction + Q128.128 price bound), in
 *   hop order.
 * @property amountIn Raw atomic amount sold (u128).
 * @property amountOutMin The submitted minimum final output (u128).
 * @property nonce The submitted u64 nonce.
 * @property deadline The submitted absolute block height (u32).
 * @property transactionId The request transaction's id.
 * @property program The core AMM program the swap targets (`swap_outputs`
 *   lives here even for router-submitted requests).
 */
export interface MultiHopSwapHandle {
  swapId?: string
  blindingFactor?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  tokenInWrapped?: boolean
  tokenOutWrapped?: boolean
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
 * path, bound validation), resolves the input token's wrapped-ness (plain
 * inputs call `swap_multi_hop` on the core AMM; wrapped inputs call
 * `swap_mh_from_wrapped` on the router, spending the caller's underlying
 * records), obtains a single-use blinded identity and a token record,
 * submits the request, and returns a serializable
 * {@link MultiHopSwapHandle}. The chain computes the outcome at finalize;
 * read it with `getSwapOutput` and collect it with `claimSwapOutput`.
 *
 * Signer paths mirror `swap`:
 * - **Local account** — derives the blinding identity from the view key,
 *   auto-selects an unspent record, proves locally, and returns a handle
 *   with `swapId`/`blindedAddress` already filled.
 * - **Wallet account** — emits wallet-derived requests for the blinding
 *   slots (`tokenRecord` must be provided); the wallet proves and returns a
 *   transaction id.
 *
 * Hits the network: per-hop pool/slot reads, route reads (cached), a
 * deadline read, a record scan (local), and the transaction itself. Signs,
 * and on the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The route intent and optional overrides.
 * @returns The multi-hop handle — persist it; the claim consumes it.
 * @throws When a pool does not exist; when the token path does not connect;
 *   when the intent violates the contract's rules (hop count, bad bounds);
 *   when a routed (wrapped-input) swap resolves to a zero `amount_out_min`
 *   (the router rejects it — supply `expectedOut` or lower the slippage);
 *   when no record covers the amount; when a wallet account is used without
 *   `tokenRecord`; and on transport/proving errors.
 *
 * @example
 * const handle = await swapMultiHop(client, {
 *   poolKeys: [ethUsdcPool, usdcAleoPool],
 *   tokenInId: ethTokenId,
 *   amountIn: 10n ** 18n,
 * })
 * // …await finalize, then:
 * // const res = await claimSwapOutput(client, { handle })
 */
export async function swapMultiHop(client: Client, params: SwapMultiHopParameters): Promise<SwapMultiHopReturnType> {
  const program = params.program ?? SHIELD_SWAP
  const routerProgram = params.routerProgram ?? SHIELD_SWAP_ROUTER

  // Live per-hop pool state drives direction and bound validation.
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

  // Wrapped-ness decides the dispatch target and which records are spent.
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

  const account = requireAccount(client, 'swapMultiHop')
  const isLocal = account.type === 'local'

  // Shared tail after the signer-dependent slots: tokens, amounts, the
  // three hop structs (zero-padded), hop count, nonce, deadline — the
  // deployed ABI's exact order, identical for core and router.
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
    // The identity scope is the CORE program even for router submissions.
    const identity =
      params.blindedIdentity ??
      (await nextBlindedIdentity(client, {
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
          function: 'swap_mh_from_wrapped',
          imports: params.imports,
          inputs: [recordInput, senderProof!, identity.blindingFactor, identity.blindedAddress, ...tail],
        })
      : await executeContract(client, {
          program,
          function: 'swap_multi_hop',
          imports: params.imports,
          inputs: [identity.blindingFactor, identity.blindedAddress, recordInput, ...tail],
        })

    // The public swap id is output 0 on the core, output 1 on the router
    // (the router's output 0 is the underlying change record).
    const swapId = result.outputs[route.wrapped ? 1 : 0]
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
    program: route.wrapped ? routerProgram : program,
    function: route.wrapped ? 'swap_mh_from_wrapped' : 'swap_multi_hop',
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs: route.wrapped
      ? [params.tokenRecord, senderProof!, ...blindingInputs, ...tail]
      : [...blindingInputs, params.tokenRecord, ...tail],
  })

  return {
    ...handleBase,
    swapId,
    blindingFactor: params.blindedIdentity?.blindingFactor,
    blindedAddress: params.blindedIdentity?.blindedAddress,
    transactionId,
  }
}
