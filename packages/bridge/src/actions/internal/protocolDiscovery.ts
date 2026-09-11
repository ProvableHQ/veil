import type {
  BridgeEnvironment,
  BridgeProtocol,
  BridgeRegistry,
  ProtocolBridgeAsset,
  ProtocolBridgeRoute,
} from '../../types/protocol.js'

/**
 * Selects chain-specific assets from a registry catalog.
 *
 * @property environment Optional mainnet or testnet filter.
 * @property chainId Optional registry chain identifier filter.
 * @property symbol Optional case-insensitive token symbol filter.
 */
export type GetAssetsParameters = {
  environment?: BridgeEnvironment | undefined
  chainId?: string | undefined
  symbol?: string | undefined
}

/**
 * Selects directional bridge routes from a registry catalog.
 *
 * @property environment Optional mainnet or testnet filter.
 * @property protocol Optional bridge provider filter.
 * @property sourceChainId Optional source registry chain identifier.
 * @property destinationChainId Optional destination registry chain identifier.
 * @property symbol Optional case-insensitive source or destination token symbol.
 * @property includeUnavailable Includes disabled routes when true. Defaults to false; routes awaiting metadata remain visible.
 */
export type GetRoutesParameters = {
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
 * Reads only the supplied registry. Filters match identifiers and symbols
 * case-insensitively without contacting a chain or bridge provider.
 *
 * @param registry Supported chains and chain-specific assets available to the application.
 * @param params Optional environment, chain, and symbol filters.
 * @returns Matching assets in registry order.
 *
 * @example
 * const usdcx = filterProtocolAssets(registry, { symbol: 'USDCx' })
 */
export function filterProtocolAssets(
  registry: BridgeRegistry,
  params: GetAssetsParameters = {},
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
 * Reads only the supplied registry. Routes marked `disabled` are omitted unless
 * `includeUnavailable` is true; `metadata-required` routes remain visible so
 * applications can distinguish known protocol support from execution readiness
 * without contacting a chain or bridge provider.
 *
 * @param registry Supported chains, assets, and directional provider routes available to the application.
 * @param params Optional protocol, environment, endpoint, and symbol filters.
 * @returns Matching directional routes in registry order.
 *
 * @example
 * const outbound = filterProtocolRoutes(registry, { sourceChainId: 'aleo' })
 */
export function filterProtocolRoutes(
  registry: BridgeRegistry,
  params: GetRoutesParameters = {},
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
