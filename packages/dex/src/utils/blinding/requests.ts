import type { AlgorithmGrant, InputRequest } from '@veil/core'
import { DEFAULT_PROGRAM } from '../../constants.js'

// Wallet-signer path only: these build the `derived` InputRequests a
// Shield-like wallet fulfils from its own view key. Local signers cannot use
// them — no wallet exists to fulfil a request — and must pass literals
// derived via blinded-identity.ts instead.

/**
 * Wallet-standard algorithm names for wallet-side derivation (see core's
 * `KNOWN_ALGORITHMS`). A dapp talking to a privacy-preserving wallet fills the
 * blinding-factor / blinded-address input slots with `derived` InputRequests
 * naming these algorithms instead of deriving locally.
 */
export const BLINDING_FACTOR_ALGORITHM = 'program-scoped-blinding-factor'
export const BLINDED_ADDRESS_ALGORITHM = 'program-scoped-blinded-address'

/** The mapping the wallet tracks used blinded addresses against. */
export const BLINDING_MEMBERSHIP_MAPPING = 'used_blinded_addresses'

/**
 * Connect-time allowlist for the program's wallet-derived inputs.
 *
 * A wallet refuses any `derived` request whose (algorithm, program, function,
 * inputPosition) tuple was not granted at connect time — pass this array in
 * `ConnectOptions.algorithmsAllowed` so private swaps and claims work.
 * Positions follow the transition declarations: `swap_private(record,
 * blinding_factor@1, blinded_address@2, …)`,
 * `claim_swap_output_private(blinding_factor@0, blinded_address@1, …)`.
 */
export function shieldSwapAlgorithmGrants(program: string = DEFAULT_PROGRAM): AlgorithmGrant[] {
  return [
    { algorithm: BLINDING_FACTOR_ALGORITHM, program, function: 'swap_private', inputPosition: 1 },
    { algorithm: BLINDED_ADDRESS_ALGORITHM, program, function: 'swap_private', inputPosition: 2 },
    { algorithm: BLINDING_FACTOR_ALGORITHM, program, function: 'claim_swap_output_private', inputPosition: 0 },
    { algorithm: BLINDED_ADDRESS_ALGORITHM, program, function: 'claim_swap_output_private', inputPosition: 1 },
  ]
}

/** The grants for {@link DEFAULT_PROGRAM} — pass `shieldSwapAlgorithmGrants(program)` when overriding. */
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
 * substitutes the derived factor — the dapp never sees it. Pure and local.
 *
 * @param program Program the derivation is scoped to. Defaults to
 *   `DEFAULT_PROGRAM` (the live deployment).
 * @returns The InputRequest for `swap_private`'s blinding-factor slot.
 *
 * @example
 * inputs[1] = blindingFactorIssueRequest()
 */
export function blindingFactorIssueRequest(program: string = DEFAULT_PROGRAM): InputRequest {
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
 *   `DEFAULT_PROGRAM` (the live deployment).
 * @returns The InputRequest for `swap_private`'s blinded-address slot.
 */
export function blindedAddressIssueRequest(program: string = DEFAULT_PROGRAM): InputRequest {
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
 *   `DEFAULT_PROGRAM` (the live deployment).
 * @returns The InputRequest for `claim_swap_output_private`'s blinding-factor slot.
 */
export function blindingFactorResolveRequest(
  targetBlindedAddress: string,
  program: string = DEFAULT_PROGRAM,
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
 *   `DEFAULT_PROGRAM` (the live deployment).
 * @returns The InputRequest for `claim_swap_output_private`'s blinded-address slot.
 */
export function blindedAddressResolveRequest(
  targetBlindedAddress: string,
  program: string = DEFAULT_PROGRAM,
): InputRequest {
  return { type: 'derived', algorithm: BLINDED_ADDRESS_ALGORITHM, args: resolveArgs(program, targetBlindedAddress) }
}
