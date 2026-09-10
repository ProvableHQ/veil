import type { BridgeRegistry, ProtocolBridgeRoute } from '../types/protocol.js'
import {
  filterProtocolRoutes as listRoutes,
  type GetRoutesParameters,
} from './internal/protocolDiscovery.js'

export type { GetRoutesParameters } from './internal/protocolDiscovery.js'

/**
 * Lists directional routes from a bridge registry.
 *
 * Pure and local. Unavailable routes are omitted unless explicitly requested.
 *
 * @param registry Reviewed registry snapshot.
 * @param params Optional route and availability filters.
 * @returns Matching routes in registry order.
 * @example const routes = getRoutes(registry, { sourceChainId: 'ethereum' })
 */
export function getRoutes(
  registry: BridgeRegistry,
  params: GetRoutesParameters = {},
): ProtocolBridgeRoute[] {
  return listRoutes(registry, params)
}
