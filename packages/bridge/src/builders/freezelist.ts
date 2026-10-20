import { freezelistProofGrant, freezelistProofRequest, type AlgorithmGrant, type FreezelistProofRequest } from '@provablehq/veil-core'
import { resolvePrivacyAsset } from '../actions/internal/aleoPrivacy.js'
import type { BridgeEndpoint, BridgePlan, BridgeRegistry } from '../types/protocol.js'
import { bridgeFreezelistProgram } from '../utils/freezelist.js'
import { buildXReserveBurnCall } from './buildXReserveBurnCall.js'

/**
 * Selects a reviewed Aleo asset for signer-only wallet freezelist derivation.
 * @property registry Supplies reviewed asset programs without fetching mutable deployment metadata.
 * @property asset Selects the Aleo chain and ARC-22 asset requiring a proof.
 * @example const options: BridgeFreezelistParameters = { registry, asset: { chain: 'aleo', asset: 'usdcx' } }
 */
export type BridgeFreezelistParameters = {
  registry: BridgeRegistry
  asset: BridgeEndpoint
}

/**
 * Builds a signer-only wallet proof request from reviewed bridge asset metadata.
 * Pass the result as `merkleProof` to select wallet derivation explicitly; omission resolves proofs automatically.
 * This builder performs no network access and requires no account address.
 * @param options Selects the registry and ARC-22 asset whose freezelist root is checked.
 * @returns A request requiring a compatible wallet and a grant for the executed proof slot.
 * @throws BridgeError When the asset or its reviewed freezelist metadata is unavailable.
 * @example const merkleProof = bridgeFreezelistProofRequest({ registry, asset: { chain: 'aleo', asset: 'usdcx' } })
 */
export function bridgeFreezelistProofRequest(options: BridgeFreezelistParameters): FreezelistProofRequest {
  const asset = resolvePrivacyAsset(options.registry, options.asset, 'unshielding')
  return freezelistProofRequest({ freezelistProgram: bridgeFreezelistProgram(asset) })
}

/**
 * Builds a grant for the ARC-22 unshield sender-proof input at position three.
 * Add this grant to the wallet connection before executing a derived unshield proof.
 * The builder reads only the supplied registry and never contacts a wallet.
 * @param options Selects the reviewed token and freezelist programs.
 * @returns A grant restricted to the token's `transfer_private_to_public` proof slot and freezelist.
 * @throws BridgeError When the asset or its reviewed freezelist metadata is unavailable.
 * @example const grant = unshieldFreezelistProofGrant({ registry, asset: { chain: 'aleo', asset: 'usdcx' } })
 */
export function unshieldFreezelistProofGrant(options: BridgeFreezelistParameters): AlgorithmGrant {
  const asset = resolvePrivacyAsset(options.registry, options.asset, 'unshielding')
  return freezelistProofGrant({
    program: asset.privacy.program,
    function: 'transfer_private_to_public',
    inputPosition: 3,
    freezelistProgram: bridgeFreezelistProgram(asset),
  })
}

/**
 * Builds a grant for the reviewed xReserve wrapper's private-burn proof slot.
 * Revalidates the transfer plan locally so saved plan metadata cannot redirect a grant.
 * No network request, signature, or submission occurs.
 * @param options Supplies the current registry and Aleo-to-EVM xReserve transfer plan.
 * @returns A grant restricted to `private_burn` input position four and the source asset's freezelist.
 * @throws BridgeError When the plan, route, amount, or required compliance metadata is invalid.
 * @example const grant = xReserveBurnFreezelistProofGrant({ registry, plan })
 */
export function xReserveBurnFreezelistProofGrant(options: { registry: BridgeRegistry; plan: BridgePlan }): AlgorithmGrant {
  // Resolve by the plan's asset identity, then let the burn builder validate it
  // against the route. Program values always come from the current registry.
  const source = options.registry.assets.find(entry => entry.id === options.plan.sourceAsset.id)
  const asset = resolvePrivacyAsset(options.registry, {
    chain: source?.chainId ?? options.plan.sourceAsset.chainId,
    asset: source?.key ?? options.plan.sourceAsset.key,
  }, 'unshielding')
  const freezelistProgram = bridgeFreezelistProgram(asset)
  const call = buildXReserveBurnCall(options.registry, {
    plan: options.plan,
    mode: 'private',
    userRecord: { type: 'record', program: asset.privacy.program, recordname: 'Token' },
    merkleProof: freezelistProofRequest({ freezelistProgram }),
  })
  return freezelistProofGrant({ program: call.program, function: call.function, inputPosition: 4, freezelistProgram })
}
