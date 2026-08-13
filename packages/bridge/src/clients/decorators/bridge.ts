import type { Client } from '@provablehq/veil-core'
import {
  getProtocolAssets,
  getProtocolRoutes,
  type GetProtocolAssetsParameters,
  type GetProtocolRoutesParameters,
} from '../../actions/protocolDiscovery.js'
import { prepareTransfer } from '../../actions/prepareTransfer.js'
import {
  executeEvmHyperlaneTransfer,
  quoteEvmHyperlaneTransfer,
} from '../../actions/evmHyperlane.js'
import {
  executeEvmXReserveTransfer,
  getXReserveAttestation,
  quoteEvmXReserveTransfer,
} from '../../actions/evmXReserve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type {
  BridgeExecutors,
  EvmHyperlaneTransferExecution,
  EvmHyperlaneTransferQuote,
  ExecuteEvmHyperlaneTransferParameters,
  QuoteEvmHyperlaneTransferParameters,
} from '../../types/evm.js'
import type {
  EvmXReserveTransferExecution,
  EvmXReserveTransferQuote,
  ExecuteEvmXReserveTransferParameters,
  GetXReserveAttestationParameters,
  QuoteEvmXReserveTransferParameters,
  XReserveAttestationResult,
  XReserveHttpTransport,
} from '../../types/xreserve.js'
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
 * @property executors Optional wallet capabilities injected at construction.
 * @property xReserveHttpTransport Optional HTTP capability for Circle attestation lookups.
 */
export type BridgeActionsConfig = {
  environment: BridgeEnvironment
  registry: BridgeRegistry
  executors?: BridgeExecutors | undefined
  xReserveHttpTransport?: XReserveHttpTransport | undefined
}

/**
 * Lists the protocol-oriented actions bound to a bridge client.
 *
 * @property getAssets Lists chain-specific registry assets without network access.
 * @property getRoutes Lists directional registry routes without network access.
 * @property prepareTransfer Validates inputs and returns a non-fund-moving execution plan.
 * @property quoteEvmHyperlaneTransfer Reads live Ethereum Warp Route fees without signing.
 * @property executeEvmHyperlaneTransfer Approves collateral when needed, then signs and dispatches through the Ethereum wallet.
 * @property quoteEvmXReserveTransfer Reads USDC balance and allowance and derives Circle deposit inputs.
 * @property executeEvmXReserveTransfer Approves USDC when needed and submits the Circle deposit.
 * @property getXReserveAttestation Fetches one Circle attestation by message hash.
 */
export type BridgeActions = {
  getAssets: (params?: GetProtocolAssetsParameters) => ProtocolBridgeAsset[]
  getRoutes: (params?: GetProtocolRoutesParameters) => ProtocolBridgeRoute[]
  prepareTransfer: (params: PrepareTransferParameters) => BridgeTransferPlan
  quoteEvmHyperlaneTransfer: (params: QuoteEvmHyperlaneTransferParameters) => Promise<EvmHyperlaneTransferQuote>
  executeEvmHyperlaneTransfer: (params: ExecuteEvmHyperlaneTransferParameters) => Promise<EvmHyperlaneTransferExecution>
  quoteEvmXReserveTransfer: (params: QuoteEvmXReserveTransferParameters) => Promise<EvmXReserveTransferQuote>
  executeEvmXReserveTransfer: (params: ExecuteEvmXReserveTransferParameters) => Promise<EvmXReserveTransferExecution>
  getXReserveAttestation: (params: GetXReserveAttestationParameters) => Promise<XReserveAttestationResult>
}

/**
 * Binds registry discovery and transfer planning to a client.
 *
 * Discovery and planning are pure and local. EVM actions use the optional
 * executor injected through the configuration and fail before network access
 * when it is absent.
 *
 * @param client Client receiving the action layer.
 * @param config Registry and default environment selected at construction.
 * @returns Bound protocol bridge actions.
 *
 * @example
 * const actions = bridgeActions(client, { environment: 'mainnet', registry })
 */
export function bridgeActions(_client: Client, config: BridgeActionsConfig): BridgeActions {
  const evmExecutor = () => {
    if (!config.executors?.evm) {
      throw new BridgeError('An EVM executor is required for Ethereum bridge actions')
    }
    return config.executors.evm
  }
  const xReserveTransport = () => {
    if (!config.xReserveHttpTransport) throw new BridgeError('An xReserve HTTP transport is required for attestation requests')
    return config.xReserveHttpTransport
  }
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
    quoteEvmHyperlaneTransfer: async (params) => quoteEvmHyperlaneTransfer(config.registry, evmExecutor(), params),
    executeEvmHyperlaneTransfer: async (params) => executeEvmHyperlaneTransfer(config.registry, evmExecutor(), params),
    quoteEvmXReserveTransfer: async (params) => quoteEvmXReserveTransfer(config.registry, evmExecutor(), params),
    executeEvmXReserveTransfer: async (params) => executeEvmXReserveTransfer(config.registry, evmExecutor(), params),
    getXReserveAttestation: async (params) => getXReserveAttestation(config.registry, xReserveTransport(), params),
  }
}
