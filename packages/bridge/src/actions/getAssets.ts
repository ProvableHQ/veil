import type { BridgeRegistry, ProtocolBridgeAsset } from '../types/protocol.js'
import {
  filterProtocolAssets as listAssets,
  type GetAssetsParameters,
} from './internal/protocolDiscovery.js'

export type { GetAssetsParameters } from './internal/protocolDiscovery.js'

/**
 * Lists chain-specific assets from a bridge registry.
 *
 * Pure and local. Filters match identifiers and symbols case-insensitively.
 *
 * @param registry Reviewed registry snapshot.
 * @param params Optional environment, chain, and symbol filters.
 * @returns Matching assets in registry order.
 * @example const assets = getAssets(registry, { symbol: 'USDCx' })
 */
export function getAssets(
  registry: BridgeRegistry,
  params: GetAssetsParameters = {},
): ProtocolBridgeAsset[] {
  return listAssets(registry, params)
}
