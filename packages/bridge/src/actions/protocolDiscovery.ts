import type {
  BridgeEnvironment,
  BridgeProtocol,
  BridgeRegistry,
  ProtocolBridgeAsset,
  ProtocolBridgeRoute,
} from '../types/protocol.js'

/** Filters the protocol asset catalog. */
export type GetProtocolAssetsParameters = {
  environment?: BridgeEnvironment | undefined
  chainId?: string | undefined
  symbol?: string | undefined
}

/** Filters directional protocol routes. */
export type GetProtocolRoutesParameters = {
  environment?: BridgeEnvironment | undefined
  protocol?: BridgeProtocol | undefined
  sourceChainId?: string | undefined
  destinationChainId?: string | undefined
  symbol?: string | undefined
  includeUnavailable?: boolean | undefined
}

/**
 * Lists chain-specific assets from a protocol bridge registry.
 *
 * Pure and local. Filters match identifiers and symbols case-insensitively.
 *
 * @param registry Reviewed registry snapshot.
 * @param params Optional environment, chain, and symbol filters.
 * @returns Matching assets in registry order.
 *
 * @example
 * const usdcx = getProtocolAssets(registry, { symbol: 'USDCx' })
 */
export function getProtocolAssets(
  registry: BridgeRegistry,
  params: GetProtocolAssetsParameters = {},
): ProtocolBridgeAsset[] {
  const chains = new Map(registry.chains.map((chain) => [chain.id, chain]))
  const chainId = params.chainId?.toLowerCase()
  const symbol = params.symbol?.toLowerCase()
  return registry.assets.filter((asset) => {
    const chain = chains.get(asset.chainId)
    return (
      (params.environment == null || chain?.environment === params.environment) &&
      (chainId == null || asset.chainId.toLowerCase() === chainId) &&
      (symbol == null || asset.symbol.toLowerCase() === symbol)
    )
  })
}

/**
 * Lists directional routes from a protocol bridge registry.
 *
 * Pure and local. Routes marked `disabled` are omitted unless
 * `includeUnavailable` is true; `metadata-required` routes remain visible so
 * applications can distinguish known protocol support from execution readiness.
 *
 * @param registry Reviewed registry snapshot.
 * @param params Optional protocol, environment, endpoint, and symbol filters.
 * @returns Matching directional routes in registry order.
 *
 * @example
 * const outbound = getProtocolRoutes(registry, { sourceChainId: 'aleo' })
 */
export function getProtocolRoutes(
  registry: BridgeRegistry,
  params: GetProtocolRoutesParameters = {},
): ProtocolBridgeRoute[] {
  const assets = new Map(registry.assets.map((asset) => [asset.id, asset]))
  const sourceChainId = params.sourceChainId?.toLowerCase()
  const destinationChainId = params.destinationChainId?.toLowerCase()
  const symbol = params.symbol?.toLowerCase()
  return registry.routes.filter((route) => {
    const source = assets.get(route.sourceAssetId)!
    const destination = assets.get(route.destinationAssetId)!
    return (
      (params.includeUnavailable === true || route.availability !== 'disabled') &&
      (params.environment == null || route.environment === params.environment) &&
      (params.protocol == null || route.protocol === params.protocol) &&
      (sourceChainId == null || source.chainId.toLowerCase() === sourceChainId) &&
      (destinationChainId == null || destination.chainId.toLowerCase() === destinationChainId) &&
      (symbol == null || source.symbol.toLowerCase() === symbol || destination.symbol.toLowerCase() === symbol)
    )
  })
}
