import type { BridgeRegistry, ProtocolBridgeRoute } from '../types/protocol.js'
import {
  filterProtocolRoutes as listProtocolRoutes,
  type GetProtocolRoutesParameters,
} from './internal/protocolDiscovery.js'

export type { GetProtocolRoutesParameters } from './internal/protocolDiscovery.js'

/**
 * Lists directional routes from a protocol bridge registry.
 *
 * Pure and local. Unavailable routes are omitted unless explicitly requested.
 *
 * @param registry Reviewed registry snapshot.
 * @param params Optional route and availability filters.
 * @returns Matching routes in registry order.
 * @example const routes = getProtocolRoutes(registry, { sourceChainId: 'ethereum' })
 */
export function getProtocolRoutes(
  registry: BridgeRegistry,
  params: GetProtocolRoutesParameters = {},
): ProtocolBridgeRoute[] {
  return listProtocolRoutes(registry, params)
}
