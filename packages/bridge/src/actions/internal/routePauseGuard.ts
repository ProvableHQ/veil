import type { BridgeChainClients } from '../../connections/resolve.js'
import { BridgeRoutePausedError } from '../../errors/bridgeErrors.js'
import type { BridgeRouteStatus } from '../../types/actions.js'
import type { BridgeRegistry } from '../../types/protocol.js'
import { getRouteStatus } from '../getRouteStatus.js'

/**
 * Reads a route's pause flags and refuses to continue when any flag is set.
 *
 * Runs before a fund-moving action touches a wallet so that a halted route
 * costs the caller nothing. Only a flag that reads as paused blocks. A flag
 * that could not be read, or whose chain has no configured client, does not
 * block: the chain enforces the pause regardless, and a node outage must not
 * refuse transfers that existing integrations could submit before this check
 * existed.
 *
 * @param registry Supported chains, assets, and reviewed deployments carrying the pause flag locations.
 * @param clients Public chain access keyed by registry chain id.
 * @param routeId Directional route about to be executed.
 * @returns The route status when no flag reads as paused.
 * @throws BridgeRoutePausedError When at least one flag reads as paused.
 */
export async function assertRouteNotPaused(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  routeId: string,
): Promise<BridgeRouteStatus> {
  const status = await getRouteStatus(registry, clients, { routeId })
  if (status.paused) throw new BridgeRoutePausedError(status)
  return status
}
