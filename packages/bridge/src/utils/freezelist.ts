import { isFreezelistProofRequest, type FreezelistProofInput } from '@provablehq/veil-core'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { ProtocolBridgeAsset } from '../types/protocol.js'

/**
 * Resolves a reviewed ARC-22 freezelist program without network access.
 * @param asset Current registry asset declaring the token's compliance program.
 * @returns The configured program whose root the token checks.
 * @throws BridgeError When the asset is not ARC-22 or reviewed metadata is missing or malformed.
 * @example const program = bridgeFreezelistProgram(asset)
 */
export function bridgeFreezelistProgram(asset: ProtocolBridgeAsset): string {
  if (asset.privacy?.kind !== 'arc22') throw new BridgeError(`Compliance proofs require an ARC-22 asset: ${asset.id}`)
  const program = asset.privacy.freezelistProgram
  if (typeof program !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*\.aleo$/.test(program)) {
    throw new BridgeError(`Reviewed freezelist program metadata is required for ${asset.id}`)
  }
  return program
}

/**
 * Validates a bridge proof request against the current asset's reviewed freezelist.
 * Literal inputs retain their existing behavior; wallet requests always prove the signer.
 * @param input Proof literal or untrusted derived input to validate before proving.
 * @param asset Current registry asset whose sender exclusion proof is required.
 * @returns The input unchanged after validation.
 * @throws BridgeError When a derived input is malformed, names another list, or overrides the signer.
 * @example const proof = validateBridgeFreezelistProof(params.merkleProof, asset)
 */
export function validateBridgeFreezelistProof(input: unknown, asset: ProtocolBridgeAsset): FreezelistProofInput {
  if (typeof input === 'string') return input
  if (!isFreezelistProofRequest(input)) throw new BridgeError('Expected an encoded proof literal or program-freezelist-exclusion-proof request')
  if (input.args.address !== undefined) {
    throw new BridgeError('Bridge freezelist proof requests must omit address to prove the wallet signer')
  }
  if (input.args.freezelistProgram.value !== bridgeFreezelistProgram(asset)) {
    throw new BridgeError(`Wallet freezelist proof must use the reviewed program for ${asset.id}`)
  }
  return input
}
