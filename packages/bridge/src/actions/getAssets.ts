import type { BridgeRegistry, ProtocolBridgeAsset } from '../types/protocol.js'
import {
  filterProtocolAssets as listAssets,
  type GetAssetsParameters,
} from './internal/protocolDiscovery.js'

export type { GetAssetsParameters } from './internal/protocolDiscovery.js'

/**
 * Lists the assets available for cross-chain transfers.
 *
 * Each result describes an asset on one chain, including the symbol, decimal
 * precision, public identifier, and supported Aleo privacy conversions. The
 * list can be narrowed by network, chain, or asset symbol.
 *
 * No blockchain or bridge provider is contacted, no wallet approval is
 * requested, and no funds move.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param params Optional filters for the network, chain, and asset symbol.
 * @returns Assets that can participate in a matching cross-chain transfer.
 * @example const assets = getAssets(registry, { symbol: 'USDCx' })
 */
export function getAssets(
  registry: BridgeRegistry,
  params: GetAssetsParameters = {},
): ProtocolBridgeAsset[] {
  return listAssets(registry, params)
}
