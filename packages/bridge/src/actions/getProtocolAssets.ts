import type { BridgeRegistry, ProtocolBridgeAsset } from '../types/protocol.js'
import {
  filterProtocolAssets as listProtocolAssets,
  type GetProtocolAssetsParameters,
} from './internal/protocolDiscovery.js'

export type { GetProtocolAssetsParameters } from './internal/protocolDiscovery.js'

/**
 * Lists chain-specific assets from a protocol bridge registry.
 *
 * Pure and local. Filters match identifiers and symbols case-insensitively.
 *
 * @param registry Reviewed registry snapshot.
 * @param params Optional environment, chain, and symbol filters.
 * @returns Matching assets in registry order.
 * @example const assets = getProtocolAssets(registry, { symbol: 'USDCx' })
 */
export function getProtocolAssets(
  registry: BridgeRegistry,
  params: GetProtocolAssetsParameters = {},
): ProtocolBridgeAsset[] {
  return listProtocolAssets(registry, params)
}
