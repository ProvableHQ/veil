import { getProtocolAssets, getProtocolRoutes, type GetProtocolAssetsParameters, type GetProtocolRoutesParameters } from '../../actions/protocolDiscovery.js'
import { prepareTransfer } from '../../actions/prepareTransfer.js'
import { executeEvmHyperlaneTransfer, quoteEvmHyperlaneTransfer } from '../../actions/evmHyperlane.js'
import { executeEvmXReserveTransfer, getXReserveAttestation, quoteEvmXReserveTransfer } from '../../actions/evmXReserve.js'
import { executeXReservePrivateMint } from '../../actions/xreservePrivateMint.js'
import { executeXReserveBurn } from '../../actions/xreserveBurn.js'
import { buildAleoHyperlaneTransferRemoteCall, executeAleoHyperlaneTransferRemote, quoteAleoHyperlaneGasPayment } from '../../actions/aleoHyperlane.js'
import { executeSolanaHyperlaneTransfer } from '../../actions/executeSolanaHyperlaneTransfer.js'
import { quoteSolanaHyperlaneTransfer } from '../../actions/quoteSolanaHyperlaneTransfer.js'
import {
  requireAleoClient,
  requireAleoClientWithWallet,
  requireEvmClient,
  requireEvmClientWithWallet,
  requireSolanaClient,
  requireSolanaClientWithWallet,
  type BridgeChainClients,
} from '../../connections/resolve.js'
import type { EvmHyperlaneTransferExecution, EvmHyperlaneTransferQuote, ExecuteEvmHyperlaneTransferParameters, QuoteEvmHyperlaneTransferParameters } from '../../types/evm.js'
import type { ExecuteSolanaHyperlaneTransferParameters, QuoteSolanaHyperlaneTransferParameters, SolanaHyperlaneTransferExecution, SolanaHyperlaneTransferQuote } from '../../types/solana.js'
import type { EvmXReserveTransferExecution, EvmXReserveTransferQuote, ExecuteEvmXReserveTransferParameters, GetXReserveAttestationParameters, QuoteEvmXReserveTransferParameters, XReserveAttestationResult, XReserveHttpTransport } from '../../types/xreserve.js'
import type { AleoHyperlaneGasQuote, AleoHyperlaneTransferRemoteCall, AleoHyperlaneTransferRemoteExecution, ExecuteAleoHyperlaneTransferRemoteParameters, ExecuteXReservePrivateMintParameters, ExecuteXReserveBurnParameters, QuoteAleoHyperlaneGasPaymentParameters, XReserveBurnExecution, XReservePrivateMintExecution } from '../../types/aleo.js'
import type { BridgeEnvironment, BridgeRegistry, BridgeTransferPlan, PrepareTransferParameters, ProtocolBridgeAsset, ProtocolBridgeRoute } from '../../types/protocol.js'
import { BridgeError } from '../../errors/bridgeErrors.js'

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
  prepareTransfer: (params: PrepareTransferParameters) => BridgeTransferPlan
  quoteEvmHyperlaneTransfer: (params: QuoteEvmHyperlaneTransferParameters) => Promise<EvmHyperlaneTransferQuote>
  executeEvmHyperlaneTransfer: (params: ExecuteEvmHyperlaneTransferParameters) => Promise<EvmHyperlaneTransferExecution>
  quoteEvmXReserveTransfer: (params: QuoteEvmXReserveTransferParameters) => Promise<EvmXReserveTransferQuote>
  executeEvmXReserveTransfer: (params: ExecuteEvmXReserveTransferParameters) => Promise<EvmXReserveTransferExecution>
  getXReserveAttestation: (params: GetXReserveAttestationParameters) => Promise<XReserveAttestationResult>
  executeXReservePrivateMint: (params: ExecuteXReservePrivateMintParameters) => Promise<XReservePrivateMintExecution>
  executeXReserveBurn: (params: ExecuteXReserveBurnParameters) => Promise<XReserveBurnExecution>
  buildAleoHyperlaneTransferRemoteCall: (params: ExecuteAleoHyperlaneTransferRemoteParameters) => AleoHyperlaneTransferRemoteCall
  quoteAleoHyperlaneGasPayment: (params: QuoteAleoHyperlaneGasPaymentParameters) => Promise<AleoHyperlaneGasQuote>
  executeAleoHyperlaneTransferRemote: (params: ExecuteAleoHyperlaneTransferRemoteParameters) => Promise<AleoHyperlaneTransferRemoteExecution>
  quoteSolanaHyperlaneTransfer: (params: QuoteSolanaHyperlaneTransferParameters) => Promise<SolanaHyperlaneTransferQuote>
  executeSolanaHyperlaneTransfer: (params: ExecuteSolanaHyperlaneTransferParameters) => Promise<SolanaHyperlaneTransferExecution>
}

function sourceChain(plan: BridgeTransferPlan): string {
  return plan.sourceAsset.chainId
}

function destinationChain(plan: BridgeTransferPlan): string {
  return plan.destinationAsset.chainId
}

function routeSourceChain(registry: BridgeRegistry, routeId: string): string {
  const route = registry.routes.find((entry) => entry.id === routeId)
  const asset = route && registry.assets.find((entry) => entry.id === route.sourceAssetId)
  if (!asset) throw new BridgeError(`Unknown bridge route: ${routeId}`)
  return asset.chainId
}

/** Binds registry and private client state to bridge actions. */
export function bridgeActions(config: BridgeActionsConfig): BridgeActions {
  return {
    getAssets: (params = {}) => getProtocolAssets(config.registry, { ...params, environment: params.environment ?? config.environment }),
    getRoutes: (params = {}) => getProtocolRoutes(config.registry, { ...params, environment: params.environment ?? config.environment }),
    prepareTransfer: (params) => prepareTransfer(config.registry, params),
    quoteEvmHyperlaneTransfer: async (params) => quoteEvmHyperlaneTransfer(config.registry, requireEvmClient(config.registry, config.clients, sourceChain(params.plan)), params),
    executeEvmHyperlaneTransfer: async (params) => executeEvmHyperlaneTransfer(config.registry, requireEvmClientWithWallet(config.registry, config.clients, sourceChain(params.plan), 'execute Hyperlane transfer'), params),
    quoteEvmXReserveTransfer: async (params) => quoteEvmXReserveTransfer(config.registry, requireEvmClientWithWallet(config.registry, config.clients, sourceChain(params.plan), 'quote xReserve transfer'), params),
    executeEvmXReserveTransfer: async (params) => executeEvmXReserveTransfer(config.registry, requireEvmClientWithWallet(config.registry, config.clients, sourceChain(params.plan), 'execute xReserve transfer'), params),
    getXReserveAttestation: async (params) => getXReserveAttestation(config.registry, config.fetch as XReserveHttpTransport, params),
    executeXReservePrivateMint: async (params) => executeXReservePrivateMint(config.registry, requireAleoClientWithWallet(config.registry, config.clients, destinationChain(params.plan), 'execute xReserve private mint').walletClient, params),
    executeXReserveBurn: async (params) => executeXReserveBurn(config.registry, requireAleoClientWithWallet(config.registry, config.clients, sourceChain(params.plan), 'execute xReserve burn').walletClient, params),
    buildAleoHyperlaneTransferRemoteCall: (params) => buildAleoHyperlaneTransferRemoteCall(config.registry, params),
    quoteAleoHyperlaneGasPayment: async (params) => quoteAleoHyperlaneGasPayment(config.registry, requireAleoClient(config.registry, config.clients, routeSourceChain(config.registry, params.routeId)).publicClient, params),
    executeAleoHyperlaneTransferRemote: async (params) => executeAleoHyperlaneTransferRemote(config.registry, requireAleoClientWithWallet(config.registry, config.clients, sourceChain(params.plan), 'execute Hyperlane transfer').walletClient, params),
    quoteSolanaHyperlaneTransfer: async (params) => quoteSolanaHyperlaneTransfer(config.registry, requireSolanaClient(config.registry, config.clients, sourceChain(params.plan)), params),
    executeSolanaHyperlaneTransfer: async (params) => {
      const client = requireSolanaClientWithWallet(config.registry, config.clients, sourceChain(params.plan), 'execute Hyperlane transfer')
      return executeSolanaHyperlaneTransfer(config.registry, client, params)
    },
  }
}
