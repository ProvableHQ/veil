import type { AlgorithmGrant, InputRequest } from '@provablehq/veil-core'
import { SHIELD_SWAP, SHIELD_SWAP_ROUTER } from '../../constants.js'

// Wallet-signer path only: these build the `derived` InputRequests a
// Shield-like wallet fulfils from its own view key. Local signers cannot use
// them — no wallet exists to fulfil a request — and must pass literals
// derived via blinded-identity.ts instead.

/**
 * Wallet-standard algorithm name for wallet-side blinding-factor derivation
 * (see core's `KNOWN_ALGORITHMS`). A dapp talking to a privacy-preserving
 * wallet fills the blinding-factor input slot with a `derived` InputRequest
 * naming this algorithm instead of deriving the factor locally.
 */
export const BLINDING_FACTOR_ALGORITHM = 'program-scoped-blinding-factor'

/**
 * Wallet-standard algorithm name for the matching blinded-address derivation.
 * Companion to {@link BLINDING_FACTOR_ALGORITHM} — the wallet fulfils both
 * slots from the same counter, so requests naming the two algorithms MUST
 * travel in the same transaction.
 */
export const BLINDED_ADDRESS_ALGORITHM = 'program-scoped-blinded-address'

/** The mapping the wallet tracks used blinded addresses against. */
export const BLINDING_MEMBERSHIP_MAPPING = 'used_blinded_addresses'

/**
 * Parameters for {@link shieldSwapAlgorithmGrants}.
 *
 * @property program Core AMM program carrying the direct swap/claim
 *   transitions. Defaults to `shield_swap.aleo`.
 * @property routerProgram Swap router carrying the wrapped-input and
 *   wrapped-claim transitions. Defaults to `shield_swap_router.aleo`.
 */
export interface ShieldSwapAlgorithmGrantsParameters {
  program?: string
  routerProgram?: string
}

/**
 * Connect-time allowlist for the stack's wallet-derived inputs.
 *
 * A wallet refuses any `derived` request whose (algorithm, program, function,
 * inputPosition) tuple was not granted at connect time — pass this array in
 * `ConnectOptions.algorithmsAllowed` so private swaps and claims work on both
 * the core AMM and the swap router. Positions follow the deployed transition
 * declarations: core `swap` takes the blinding pair at inputs 1–2,
 * `swap_multi_hop`, `claim_swap_output`, and `claim_swap_output_no_refund` at
 * 0–1; the router's `swap_from_wrapped`/`swap_mh_from_wrapped` at 2–3 (after
 * the underlying record and sender proof), and every `claim_to_*` variant —
 * refund-bearing and no-refund alike — at 0–1.
 *
 * @param params Optional program overrides for non-default deployments.
 * @returns The grant tuples for every blinding slot in the stack.
 *
 * @example
 * connect({ algorithmsAllowed: shieldSwapAlgorithmGrants() })
 */
export function shieldSwapAlgorithmGrants(params: ShieldSwapAlgorithmGrantsParameters = {}): AlgorithmGrant[] {
  const program = params.program ?? SHIELD_SWAP
  const router = params.routerProgram ?? SHIELD_SWAP_ROUTER
  const pair = (target: string, fn: string, factorPosition: number): AlgorithmGrant[] => [
    { algorithm: BLINDING_FACTOR_ALGORITHM, program: target, function: fn, inputPosition: factorPosition },
    { algorithm: BLINDED_ADDRESS_ALGORITHM, program: target, function: fn, inputPosition: factorPosition + 1 },
  ]
  return [
    ...pair(program, 'swap', 1),
    ...pair(program, 'swap_multi_hop', 0),
    ...pair(program, 'claim_swap_output', 0),
    ...pair(router, 'swap_from_wrapped', 2),
    ...pair(router, 'swap_mh_from_wrapped', 2),
    ...pair(router, 'claim_to_wrapped_refund_arc20', 0),
    ...pair(router, 'claim_to_arc20_refund_wrapped', 0),
    ...pair(router, 'claim_to_wrapped_refund_wrapped', 0),
    ...pair(program, 'claim_swap_output_no_refund', 0),
    ...pair(router, 'claim_to_arc20_no_refund', 0),
    ...pair(router, 'claim_to_wrapped_no_refund', 0),
  ]
}

/** The grants for the default deployment — pass `shieldSwapAlgorithmGrants(params)` when overriding programs. */
export const SHIELD_SWAP_ALGORITHM_GRANTS: AlgorithmGrant[] = shieldSwapAlgorithmGrants()

/** Shared args for the issue-mode derived requests (fresh counter slot). */
function issueArgs(program: string) {
  return {
    mode: { type: 'string', value: 'issue' },
    membershipProgram: { type: 'string', value: program },
    membershipMapping: { type: 'string', value: BLINDING_MEMBERSHIP_MAPPING },
  }
}

/** Shared args for the resolve-mode requests (re-derive a past counter). */
function resolveArgs(program: string, targetBlindedAddress: string) {
  return {
    mode: { type: 'string', value: 'resolve' },
    membershipProgram: { type: 'string', value: program },
    membershipMapping: { type: 'string', value: BLINDING_MEMBERSHIP_MAPPING },
    targetAddress: { type: 'address', value: targetBlindedAddress },
  }
}

/**
 * Builds the wallet-derived request for a fresh blinding factor (swap time).
 *
 * The wallet burns a new counter slot scoped to (program, mapping) and
 * substitutes the derived factor — the dapp never sees it. The scope is the
 * CORE program even for router-submitted transactions: the derivation and
 * the `used_blinded_addresses` mapping live on the AMM. Pure and local.
 *
 * @param program Program the derivation is scoped to. Defaults to
 *   `shield_swap.aleo`.
 * @returns The InputRequest for the swap's blinding-factor slot.
 *
 * @example
 * inputs[1] = blindingFactorIssueRequest()
 */
export function blindingFactorIssueRequest(program: string = SHIELD_SWAP): InputRequest {
  return { type: 'derived', algorithm: BLINDING_FACTOR_ALGORITHM, args: issueArgs(program) }
}

/**
 * Builds the wallet-derived request for the matching blinded address (swap time).
 *
 * MUST be paired with {@link blindingFactorIssueRequest} in the same
 * transaction — the wallet fulfils both from the same counter slot. Pure and
 * local.
 *
 * @param program Program the derivation is scoped to. Defaults to
 *   `shield_swap.aleo`.
 * @returns The InputRequest for the swap's blinded-address slot.
 */
export function blindedAddressIssueRequest(program: string = SHIELD_SWAP): InputRequest {
  return { type: 'derived', algorithm: BLINDED_ADDRESS_ALGORITHM, args: issueArgs(program) }
}

/**
 * Builds the wallet-derived request that re-derives a past blinding factor
 * (claim time).
 *
 * Given the public blinded address a swap recorded, the wallet inverts which
 * counter minted it and substitutes the same factor — proving ownership
 * without the dapp ever holding it. Pure and local.
 *
 * @param targetBlindedAddress The public blinded address from the swap
 *   (`SwapHandle.blindedAddress`).
 * @param program Program the derivation is scoped to. Defaults to
 *   `shield_swap.aleo`.
 * @returns The InputRequest for the claim's blinding-factor slot.
 */
export function blindingFactorResolveRequest(
  targetBlindedAddress: string,
  program: string = SHIELD_SWAP,
): InputRequest {
  return { type: 'derived', algorithm: BLINDING_FACTOR_ALGORITHM, args: resolveArgs(program, targetBlindedAddress) }
}

/**
 * Builds the wallet-derived request for the blinded address at claim time.
 *
 * Companion to {@link blindingFactorResolveRequest} — the wallet re-derives
 * and substitutes the same address, keeping both claim slots
 * wallet-fulfilled. Pure and local.
 *
 * @param targetBlindedAddress The public blinded address from the swap.
 * @param program Program the derivation is scoped to. Defaults to
 *   `shield_swap.aleo`.
 * @returns The InputRequest for the claim's blinded-address slot.
 */
export function blindedAddressResolveRequest(
  targetBlindedAddress: string,
  program: string = SHIELD_SWAP,
): InputRequest {
  return { type: 'derived', algorithm: BLINDED_ADDRESS_ALGORITHM, args: resolveArgs(program, targetBlindedAddress) }
}
