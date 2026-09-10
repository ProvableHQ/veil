import { getAssets, type GetAssetsParameters } from '../../actions/getAssets.js'
import { getRoutes, type GetRoutesParameters } from '../../actions/getRoutes.js'
import { prepare } from '../../actions/prepare.js'
import { execute } from '../../actions/execute.js'
import { quote } from '../../actions/quote.js'
import { complete } from '../../actions/complete.js'
import { getStatus } from '../../actions/getStatus.js'
import { waitForStatus } from '../../actions/waitForStatus.js'
import { recover } from '../../actions/recover.js'
import { resume } from '../../actions/resume.js'
import { wait } from '../../actions/wait.js'
import type { BridgeChainClients } from '../../connections/resolve.js'
import type { BridgeEnvironment, BridgeProgress, BridgeReceipt, BridgeRegistry, BridgePlan, PrepareParameters, ProtocolBridgeAsset, ProtocolBridgeRoute } from '../../types/protocol.js'
import type { CompleteParameters, ExecuteParameters, GetStatusParameters, QuoteParameters, RecoverParameters, ResumeParameters, WaitForStatusParameters, WaitParameters, BridgeExecution, BridgeQuote } from '../../types/actions.js'

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
  getAssets: (params?: GetAssetsParameters) => ProtocolBridgeAsset[]
  getRoutes: (params?: GetRoutesParameters) => ProtocolBridgeRoute[]
  prepare: (params: PrepareParameters) => BridgePlan
  quote: (params: QuoteParameters) => Promise<BridgeQuote>
  execute: (params: ExecuteParameters) => Promise<BridgeExecution>
  getStatus: (params: GetStatusParameters) => Promise<BridgeReceipt>
  waitForStatus: (params: WaitForStatusParameters) => Promise<BridgeReceipt>
  complete: (params: CompleteParameters) => Promise<BridgeExecution>
  recover: (params: RecoverParameters) => Promise<BridgeProgress>
  resume: (params: ResumeParameters) => Promise<BridgeExecution>
  wait: (params: WaitParameters) => Promise<BridgeProgress>
}

/** Binds registry and private client state to bridge actions. */
export function bridgeActions(config: BridgeActionsConfig): BridgeActions {
  return {
    getAssets: (params = {}) => getAssets(config.registry, { ...params, environment: params.environment ?? config.environment }),
    getRoutes: (params = {}) => getRoutes(config.registry, { ...params, environment: params.environment ?? config.environment }),
    prepare: (params) => prepare(config.registry, params),
    quote: async (params) => quote(config.registry, config.clients, params),
    execute: async (params) => execute(config.registry, config.clients, params),
    getStatus: async (params) => getStatus(config.registry, config.clients, config.fetch, params),
    waitForStatus: async (params) => waitForStatus(config.registry, config.clients, config.fetch, params),
    complete: async (params) => complete(config.registry, config.clients, params),
    recover: async (params) => recover(config.registry, config.clients, config.fetch, params),
    resume: async (params) => resume(config.registry, config.clients, params),
    wait: async (params) => wait(config.registry, config.clients, config.fetch, params),
  }
}
