import { getProtocolAssets, type GetProtocolAssetsParameters } from '../../actions/getProtocolAssets.js'
import { getProtocolRoutes, type GetProtocolRoutesParameters } from '../../actions/getProtocolRoutes.js'
import { prepare } from '../../actions/prepare.js'
import { execute } from '../../actions/execute.js'
import { quote } from '../../actions/quote.js'
import { getXReserveAttestation } from '../../actions/getXReserveAttestation.js'
import { executeXReservePrivateMint } from '../../actions/executeXReservePrivateMint.js'
import {
  requireAleoClientWithWallet,
  type BridgeChainClients,
} from '../../connections/resolve.js'
import type { GetXReserveAttestationParameters, XReserveAttestationResult, XReserveHttpTransport } from '../../types/xreserve.js'
import type { ExecuteXReservePrivateMintParameters, XReservePrivateMintExecution } from '../../types/aleo.js'
import type { BridgeEnvironment, BridgeRegistry, BridgePlan, PrepareParameters, ProtocolBridgeAsset, ProtocolBridgeRoute } from '../../types/protocol.js'
import type { ExecuteParameters, QuoteParameters, BridgeExecution, BridgeQuote } from '../../types/actions.js'

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

/** Lists protocol discovery, planning, quote, and execution operations. */
export type BridgeActions = {
  getAssets: (params?: GetProtocolAssetsParameters) => ProtocolBridgeAsset[]
  getRoutes: (params?: GetProtocolRoutesParameters) => ProtocolBridgeRoute[]
  prepare: (params: PrepareParameters) => BridgePlan
  quote: (params: QuoteParameters) => Promise<BridgeQuote>
  execute: (params: ExecuteParameters) => Promise<BridgeExecution>
  getXReserveAttestation: (params: GetXReserveAttestationParameters) => Promise<XReserveAttestationResult>
  executeXReservePrivateMint: (params: ExecuteXReservePrivateMintParameters) => Promise<XReservePrivateMintExecution>
}

function destinationChain(plan: BridgePlan): string {
  return plan.destinationAsset.chainId
}

/** Binds registry and private client state to bridge actions. */
export function bridgeActions(config: BridgeActionsConfig): BridgeActions {
  return {
    getAssets: (params = {}) => getProtocolAssets(config.registry, { ...params, environment: params.environment ?? config.environment }),
    getRoutes: (params = {}) => getProtocolRoutes(config.registry, { ...params, environment: params.environment ?? config.environment }),
    prepare: (params) => prepare(config.registry, params),
    quote: async (params) => quote(config.registry, config.clients, params),
    execute: async (params) => execute(config.registry, config.clients, params),
    getXReserveAttestation: async (params) => getXReserveAttestation(config.registry, config.fetch as XReserveHttpTransport, params),
    executeXReservePrivateMint: async (params) => executeXReservePrivateMint(config.registry, requireAleoClientWithWallet(config.registry, config.clients, destinationChain(params.plan), 'execute xReserve private mint').walletClient, params),
  }
}
