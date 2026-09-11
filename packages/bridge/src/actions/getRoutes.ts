import type { BridgeRegistry, ProtocolBridgeRoute } from '../types/protocol.js'
import {
  filterProtocolRoutes as listRoutes,
  type GetRoutesParameters,
} from './internal/protocolDiscovery.js'

export type { GetRoutesParameters } from './internal/protocolDiscovery.js'

/**
 * Lists the supported ways to move assets between chains.
 *
 * Each result identifies one transfer direction, the source and destination
 * assets, the bridge provider, and whether the route is ready to move funds.
 * Routes that cannot currently execute are hidden unless explicitly requested.
 *
 * No blockchain or bridge provider is contacted, no wallet approval is
 * requested, and no funds move.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param params Optional filters for the provider, network, assets, chains, and availability.
 * @returns Transfer routes that match the requested direction and filters.
 * @example const routes = getRoutes(registry, { sourceChainId: 'ethereum' })
 */
export function getRoutes(
  registry: BridgeRegistry,
  params: GetRoutesParameters = {},
): ProtocolBridgeRoute[] {
  return listRoutes(registry, params)
}
