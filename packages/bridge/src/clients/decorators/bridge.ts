import { getProtocolAssets, type GetProtocolAssetsParameters } from '../../actions/getProtocolAssets.js'
import { getProtocolRoutes, type GetProtocolRoutesParameters } from '../../actions/getProtocolRoutes.js'
import { prepare } from '../../actions/prepare.js'
import { execute } from '../../actions/execute.js'
import { quote } from '../../actions/quote.js'
import { complete } from '../../actions/complete.js'
import { getStatus } from '../../actions/getStatus.js'
import { waitForStatus } from '../../actions/waitForStatus.js'
import type { BridgeChainClients } from '../../connections/resolve.js'
import type { BridgeEnvironment, BridgeReceipt, BridgeRegistry, BridgePlan, PrepareParameters, ProtocolBridgeAsset, ProtocolBridgeRoute } from '../../types/protocol.js'
import type { CompleteParameters, ExecuteParameters, GetStatusParameters, QuoteParameters, WaitForStatusParameters, BridgeExecution, BridgeQuote } from '../../types/actions.js'

/**
 * Carries validated registry and materialized client state into bound actions.
 * @property environment Default route environment.
 * @property registry Validated deployment registry.
 * @property clients Materialized chain capabilities keyed by registry chain id.
 * @property fetch Fetch implementation used for protocol HTTP requests.
 */
export type BridgeActionsConfig = {
  environment: BridgeEnvironment
  registry: BridgeRegistry
  clients: BridgeChainClients
  fetch: typeof globalThis.fetch
}

/** Lists protocol discovery, planning, execution, status, and completion operations. */
export type BridgeActions = {
  getAssets: (params?: GetProtocolAssetsParameters) => ProtocolBridgeAsset[]
  getRoutes: (params?: GetProtocolRoutesParameters) => ProtocolBridgeRoute[]
  prepare: (params: PrepareParameters) => BridgePlan
  quote: (params: QuoteParameters) => Promise<BridgeQuote>
  execute: (params: ExecuteParameters) => Promise<BridgeExecution>
  getStatus: (params: GetStatusParameters) => Promise<BridgeReceipt>
  waitForStatus: (params: WaitForStatusParameters) => Promise<BridgeReceipt>
  complete: (params: CompleteParameters) => Promise<BridgeExecution>
}

/** Binds registry and private client state to bridge actions. */
export function bridgeActions(config: BridgeActionsConfig): BridgeActions {
  return {
    getAssets: (params = {}) => getProtocolAssets(config.registry, { ...params, environment: params.environment ?? config.environment }),
    getRoutes: (params = {}) => getProtocolRoutes(config.registry, { ...params, environment: params.environment ?? config.environment }),
    prepare: (params) => prepare(config.registry, params),
    quote: async (params) => quote(config.registry, config.clients, params),
    execute: async (params) => execute(config.registry, config.clients, params),
    getStatus: async (params) => getStatus(config.registry, config.clients, config.fetch, params),
    waitForStatus: async (params) => waitForStatus(config.registry, config.clients, config.fetch, params),
    complete: async (params) => complete(config.registry, config.clients, params),
  }
}
