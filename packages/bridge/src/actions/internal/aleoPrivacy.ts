import type { TransactionInput } from '@provablehq/veil-core'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgeEndpoint, BridgeRegistry, ProtocolBridgeAsset } from '../../types/protocol.js'
import { parseDecimalAmount } from '../../utils/units.js'

const EMPTY_PROOF = `{ siblings: [${Array(16).fill('0field').join(', ')}], leaf_index: 1u32 }`

/**
 * Supplies the canonical proof pair accepted while an ARC-22 freeze list is empty.
 *
 * The value is computed in memory and does not read Aleo or reveal a record.
 *
 * @example
 * const proof = EMPTY_MERKLE_PROOF_PAIR
 */
export const EMPTY_MERKLE_PROOF_PAIR = `[${EMPTY_PROOF}, ${EMPTY_PROOF}]`

/**
 * Resolves an Aleo asset that declares the requested privacy conversion.
 *
 * Reads only the supplied registry. No chain, wallet, or private record is
 * accessed while deciding whether the asset supports the conversion.
 *
 * @param registry Registry containing chain and asset capabilities.
 * @param endpoint Chain and asset key selected by the caller.
 * @param operation Conversion name included in unsupported-asset errors.
 * @returns The matching asset with a declared privacy capability.
 * @throws BridgeError When the asset is unknown, is not on Aleo, or lacks the capability.
 * @example
 * const asset = resolvePrivacyAsset(registry, { chain: 'aleo', asset: 'sol' }, 'shielding')
 */
export function resolvePrivacyAsset(registry: BridgeRegistry, endpoint: BridgeEndpoint, operation: 'shielding' | 'unshielding'): ProtocolBridgeAsset & { privacy: NonNullable<ProtocolBridgeAsset['privacy']> } {
  const asset = registry.assets.find((entry) => entry.chainId === endpoint.chain && entry.key === endpoint.asset)
  if (!asset) throw new BridgeError(`Unknown bridge asset: "${endpoint.chain}/${endpoint.asset}"`)
  const chain = registry.chains.find((entry) => entry.id === asset.chainId)
  if (chain?.family !== 'aleo' || !asset.privacy) {
    throw new BridgeError(`Bridge asset "${asset.id}" does not support ${operation}`)
  }
  return asset as ProtocolBridgeAsset & { privacy: NonNullable<ProtocolBridgeAsset['privacy']> }
}

/**
 * Converts a positive display amount to its u128 Aleo literal.
 *
 * Computes the exact integer in memory without reading a balance, selecting a
 * private record, or contacting Aleo.
 *
 * @param asset Asset whose decimals determine atomic precision.
 * @param amount Positive decimal amount in display units.
 * @param operation Conversion name included in invalid-amount errors.
 * @returns Exact atomic amount and its u128 literal.
 * @throws BridgeError When the amount is invalid, unrepresentable, or zero.
 * @example
 * privacyAmount(asset, '0.25', 'Shielding')
 */
export function privacyAmount(asset: ProtocolBridgeAsset, amount: string, operation: 'Shielding' | 'Unshielding'): { amountAtomic: bigint; literal: string } {
  const amountAtomic = parseDecimalAmount(amount, asset.decimals)
  if (amountAtomic <= 0n) throw new BridgeError(`${operation} amount must be greater than zero`)
  return { amountAtomic, literal: `${amountAtomic}u128` }
}

/**
 * Builds a wallet-side request for a token record covering an amount.
 *
 * Returns selection criteria rather than record plaintext. A compatible wallet
 * searches its private records only when the later transaction is authorized.
 *
 * @param program Program defining the `Token` record.
 * @param amount Minimum u128 amount the selected record must contain.
 * @returns A record request resolved privately by a compatible wallet.
 * @example
 * privacyRecord('arc20_sol.aleo', '1000000u128')
 */
export function privacyRecord(program: string, amount: string): TransactionInput {
  return {
    type: 'record',
    program,
    recordname: 'Token',
    filters: { amount: { gte: amount } },
  }
}
