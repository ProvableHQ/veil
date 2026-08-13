export {
  createBridgeClient,
  type BridgeClient,
  type BridgeClientConfig,
} from './clients/createBridgeClient.js'
export {
  bridgeActions,
  type BridgeActions,
  type BridgeActionsConfig,
} from './clients/decorators/bridge.js'

export {
  getProtocolAssets as getAssets,
  getProtocolRoutes as getRoutes,
  type GetProtocolAssetsParameters as GetAssetsParameters,
  type GetProtocolRoutesParameters as GetRoutesParameters,
} from './actions/protocolDiscovery.js'
export { prepareTransfer } from './actions/prepareTransfer.js'
export {
  executeEvmHyperlaneTransfer,
  quoteEvmHyperlaneTransfer,
} from './actions/evmHyperlane.js'
export {
  executeEvmXReserveTransfer,
  getXReserveAttestation,
  quoteEvmXReserveTransfer,
} from './actions/evmXReserve.js'
export { executeXReservePrivateMint } from './actions/xreservePrivateMint.js'

export { DEFAULT_BRIDGE_REGISTRY } from './registry/default.js'
export { validateBridgeRegistry } from './registry/validate.js'

export type {
  AleoMintMode,
  BridgeAssetKind,
  BridgeAssetLocator,
  BridgeChainFamily,
  BridgeEnvironment,
  BridgeExecutionStep,
  BridgeExecutionStepKind,
  BridgeFee,
  BridgeProtocol,
  BridgeQuoteStatus,
  BridgeRegistry,
  BridgeRouteAvailability,
  BridgeStepExecutor,
  BridgeTransferPlan,
  BridgeTransferQuote,
  BridgeTransferReceipt,
  BridgeTransferStatus,
  PrepareTransferParameters,
  ProtocolBridgeAsset,
  ProtocolBridgeChain,
  ProtocolBridgeRoute,
} from './types/protocol.js'
export type {
  BridgeExecutors,
  EvmBridgeExecutor,
  EvmHyperlaneRouteMetadata,
  EvmHyperlaneRouterType,
  EvmHyperlaneTransferExecution,
  EvmHyperlaneTransferQuote,
  ExecuteEvmHyperlaneTransferParameters,
  QuoteEvmHyperlaneTransferParameters,
} from './types/evm.js'
export type {
  EvmXReserveRouteMetadata,
  EvmXReserveTransferExecution,
  EvmXReserveTransferQuote,
  ExecuteEvmXReserveTransferParameters,
  GetXReserveAttestationParameters,
  QuoteEvmXReserveTransferParameters,
  XReserveAttestationResult,
  XReserveHttpResponse,
  XReserveHttpTransport,
} from './types/xreserve.js'
export type {
  AleoBridgeExecutor,
  ExecuteXReservePrivateMintParameters,
  XReservePrivateMintExecution,
} from './types/aleo.js'

export {
  aleoAddressToBytes32,
  aleoProgramAddress,
  buildXReserveDepositPayload,
  buildXReserveHookData,
  calculateXReserveDepositNonce,
  calculateXReserveMessageHash,
  xReserveHexToAleoBytes,
} from './utils/xreserve.js'

export { BridgeError } from './errors/bridgeErrors.js'
export { parseDecimalAmount } from './utils/units.js'
