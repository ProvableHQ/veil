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
import { executeXReservePrivateMint } from '../../actions/xreservePrivateMint.js'
import { executeXReserveBurn } from '../../actions/xreserveBurn.js'
import {
  buildAleoHyperlaneTransferRemoteCall,
  executeAleoHyperlaneTransferRemote,
  quoteAleoHyperlaneGasPayment,
} from '../../actions/aleoHyperlane.js'
import {
  executeSolanaHyperlaneTransfer,
  quoteSolanaHyperlaneTransfer,
} from '../../actions/solanaHyperlane.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import { createSolanaRpcReader } from '../../solana/rpc.js'
import type {
  BridgeExecutors,
  EvmHyperlaneTransferExecution,
  EvmHyperlaneTransferQuote,
  ExecuteEvmHyperlaneTransferParameters,
  QuoteEvmHyperlaneTransferParameters,
} from '../../types/evm.js'
import type {
  ExecuteSolanaHyperlaneTransferParameters,
  QuoteSolanaHyperlaneTransferParameters,
  SolanaBridgeExecutor,
  SolanaHyperlaneTransferExecution,
  SolanaHyperlaneTransferQuote,
  SolanaRpcConfig,
} from '../../types/solana.js'
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
  AleoHyperlaneGasQuote,
  AleoHyperlaneTransferRemoteCall,
  AleoHyperlaneTransferRemoteExecution,
  ExecuteAleoHyperlaneTransferRemoteParameters,
  ExecuteXReservePrivateMintParameters,
  ExecuteXReserveBurnParameters,
  QuoteAleoHyperlaneGasPaymentParameters,
  XReserveBurnExecution,
  XReservePrivateMintExecution,
} from '../../types/aleo.js'
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
 * @property aleoPublicClient Optional Aleo public client for on-chain reads such as Hyperlane gas quotes.
 * @property solanaRpc Optional Solana JSON-RPC endpoint for on-chain reads such as blockhash and confirmation lookups.
 */
export type BridgeActionsConfig = {
  environment: BridgeEnvironment
  registry: BridgeRegistry
  executors?: BridgeExecutors | undefined
  xReserveHttpTransport?: XReserveHttpTransport | undefined
  aleoPublicClient?: Client | undefined
  solanaRpc?: SolanaRpcConfig | undefined
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
 * @property executeXReservePrivateMint Prompts the Aleo wallet for the wrapper private mint.
 * @property executeXReserveBurn Prompts the Aleo wallet for one of the reviewed USDCx burn transitions.
 * @property buildAleoHyperlaneTransferRemoteCall Constructs the seven-input Aleo Warp Route call without wallet access.
 * @property quoteAleoHyperlaneGasPayment Reads the live interchain gas paymaster quote through the injected Aleo public client.
 * @property executeAleoHyperlaneTransferRemote Submits only fully reviewed, non-placeholder Aleo Warp Route calls.
 * @property quoteSolanaHyperlaneTransfer Reads the live Solana interchain gas paymaster quote through the injected Solana RPC reader.
 * @property executeSolanaHyperlaneTransfer Signs and submits a Solana Hyperlane transfer through the injected Solana executor.
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
  executeXReservePrivateMint: (params: ExecuteXReservePrivateMintParameters) => Promise<XReservePrivateMintExecution>
  executeXReserveBurn: (params: ExecuteXReserveBurnParameters) => Promise<XReserveBurnExecution>
  buildAleoHyperlaneTransferRemoteCall: (params: ExecuteAleoHyperlaneTransferRemoteParameters) => AleoHyperlaneTransferRemoteCall
  quoteAleoHyperlaneGasPayment: (params: QuoteAleoHyperlaneGasPaymentParameters) => Promise<AleoHyperlaneGasQuote>
  executeAleoHyperlaneTransferRemote: (params: ExecuteAleoHyperlaneTransferRemoteParameters) => Promise<AleoHyperlaneTransferRemoteExecution>
  quoteSolanaHyperlaneTransfer: (params: QuoteSolanaHyperlaneTransferParameters) => Promise<SolanaHyperlaneTransferQuote>
  executeSolanaHyperlaneTransfer: (params: ExecuteSolanaHyperlaneTransferParameters) => Promise<SolanaHyperlaneTransferExecution>
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
  const aleoExecutor = () => {
    if (!config.executors?.aleo) throw new BridgeError('An Aleo executor is required for Aleo bridge transactions')
    return config.executors.aleo
  }
  const aleoPublicClient = () => {
    if (!config.aleoPublicClient) throw new BridgeError('An Aleo public client is required for Hyperlane gas quotes')
    return config.aleoPublicClient
  }
  const solanaRpcReader = () => {
    if (!config.solanaRpc) throw new BridgeError('Solana actions require solanaRpc configuration on the bridge client')
    return createSolanaRpcReader(config.solanaRpc)
  }
  const solanaExecutor = (): SolanaBridgeExecutor => {
    if (!config.executors?.solana) throw new BridgeError('A Solana executor is required for Solana bridge transactions')
    return config.executors.solana
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
    executeXReservePrivateMint: async (params) => executeXReservePrivateMint(config.registry, aleoExecutor(), params),
    executeXReserveBurn: async (params) => executeXReserveBurn(config.registry, aleoExecutor(), params),
    buildAleoHyperlaneTransferRemoteCall: (params) => buildAleoHyperlaneTransferRemoteCall(config.registry, params),
    quoteAleoHyperlaneGasPayment: async (params) => quoteAleoHyperlaneGasPayment(config.registry, aleoPublicClient(), params),
    executeAleoHyperlaneTransferRemote: async (params) => executeAleoHyperlaneTransferRemote(config.registry, aleoExecutor(), params),
    quoteSolanaHyperlaneTransfer: async (params) => quoteSolanaHyperlaneTransfer(config.registry, solanaRpcReader(), params),
    executeSolanaHyperlaneTransfer: async (params) =>
      executeSolanaHyperlaneTransfer(config.registry, solanaExecutor(), solanaRpcReader(), params),
  }
}
