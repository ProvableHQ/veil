import type { Client } from '@provablehq/veil-core'
import {
  getProtocolAssets,
  getProtocolRoutes,
  type GetProtocolAssetsParameters,
  type GetProtocolRoutesParameters,
} from '../../actions/protocolDiscovery.js'
import { prepareTransfer } from '../../actions/prepareTransfer.js'
import type {
  BridgeEnvironment,
  BridgeRegistry,
  BridgeTransferPlan,
  PrepareTransferParameters,
  ProtocolBridgeAsset,
  ProtocolBridgeRoute,
} from '../../types/protocol.js'

/**
 * Carries registry defaults from client construction into bound actions.
 *
 * @property environment Environment applied when an action omits its filter.
 * @property registry Reviewed snapshot supplying chains, assets, and routes.
 */
export type BridgeActionsConfig = {
  environment: BridgeEnvironment
  registry: BridgeRegistry
}

/**
 * Lists the protocol-oriented actions bound to a bridge client.
 *
 * @property getAssets Lists chain-specific registry assets without network access.
 * @property getRoutes Lists directional registry routes without network access.
 * @property prepareTransfer Validates inputs and returns a non-fund-moving execution plan.
 */
export type BridgeActions = {
  getAssets: (params?: GetProtocolAssetsParameters) => ProtocolBridgeAsset[]
  getRoutes: (params?: GetProtocolRoutesParameters) => ProtocolBridgeRoute[]
  prepareTransfer: (params: PrepareTransferParameters) => BridgeTransferPlan
}

/**
 * Binds registry discovery and transfer planning to a client.
 *
 * Pure and local. The client argument reserves the viem-style decorator shape
 * for protocol executors added in later phases.
 *
 * @param client Client receiving the action layer.
 * @param config Registry and default environment selected at construction.
 * @returns Bound protocol bridge actions.
 *
 * @example
 * const actions = bridgeActions(client, { environment: 'mainnet', registry })
 */
export function bridgeActions(_client: Client, config: BridgeActionsConfig): BridgeActions {
  return {
    getAssets: (params = {}) => getProtocolAssets(config.registry, {
      ...params,
      environment: params.environment ?? config.environment,
    }),
    getRoutes: (params = {}) => getProtocolRoutes(config.registry, {
      ...params,
      environment: params.environment ?? config.environment,
    }),
    prepareTransfer: (params) => prepareTransfer(config.registry, params),
  }
}
