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
  createEvmClient,
  evmCustom,
  evmHttp,
  evmLocalAccount,
  evmPrivateKey,
  evmProvider,
  type EvmAccount,
  type EvmCallParameters,
  type EvmClient,
  type EvmClientConfig,
  type EvmHttpOptions,
  type EvmPublicClient,
  type EvmReceipt,
  type EvmRequest,
  type EvmTransactionParameters,
  type EvmTransport,
  type EvmWalletClient,
} from './connections/evm.js'
export {
  createSolanaClient,
  solanaCustom,
  solanaHttp,
  solanaKeyPair,
  solanaWallet,
  type SolanaAccount,
  type SolanaClient,
  type SolanaClientConfig,
  type SolanaHttpOptions,
  type SolanaPublicClient,
  type SolanaRequest,
  type SolanaTransport,
  type SolanaWalletClient,
} from './connections/solana.js'
export {
  createAleoClient,
  aleoWallet,
  type AleoClient,
  type AleoClientConfig,
} from './connections/aleo.js'
export type { BridgeChainClient, BridgeChainClients } from './connections/resolve.js'

export {
  getProtocolAssets as getAssets,
  type GetProtocolAssetsParameters as GetAssetsParameters,
} from './actions/getProtocolAssets.js'
export {
  getProtocolRoutes as getRoutes,
  type GetProtocolRoutesParameters as GetRoutesParameters,
} from './actions/getProtocolRoutes.js'
export { prepare } from './actions/prepare.js'
export { execute } from './actions/execute.js'
export { quote } from './actions/quote.js'
export { complete } from './actions/complete.js'
export { getStatus } from './actions/getStatus.js'
export { waitForStatus } from './actions/waitForStatus.js'
export { hyperlane, xreserve, type ProtocolHelperRegistry } from './protocols/index.js'
export { buildXReserveBurnCall } from './builders/buildXReserveBurnCall.js'
export { buildAleoHyperlaneTransferRemoteCall } from './builders/buildAleoHyperlaneTransferRemoteCall.js'

export { DEFAULT_BRIDGE_REGISTRY } from './registry/default.js'
export { validateBridgeRegistry } from './registry/validate.js'

export type {
  AleoMintMode,
  BridgeAssetKind,
  BridgeAssetLocator,
  BridgeChainFamily,
  BridgeEnvironment,
  BridgeEndpoint,
  BridgeExecutionStep,
  BridgeExecutionStepKind,
  BridgeFee,
  BridgeNextAction,
  BridgeProtocol,
  BridgeRegistry,
  BridgeRouteAvailability,
  BridgeStepExecutor,
  BridgePlan,
  BridgeReceipt,
  BridgeStatus,
  PrepareParameters,
  ProtocolBridgeAsset,
  ProtocolBridgeChain,
  ProtocolBridgeRoute,
} from './types/protocol.js'
export type {
  ExecuteParameters,
  CompleteParameters,
  GetStatusParameters,
  QuoteParameters,
  WaitForStatusParameters,
  BridgeExecution,
  BridgeExecutionKind,
  BridgeQuote,
  BridgeQuoteKind,
} from './types/actions.js'
export type {
  EvmHyperlaneRouteMetadata,
  EvmHyperlaneRouterType,
  EvmHyperlaneTransferExecution,
  EvmHyperlaneTransferQuote,
} from './types/evm.js'
export type {
  EvmXReserveRouteMetadata,
  EvmXReserveTransferExecution,
  EvmXReserveTransferQuote,
  GetXReserveAttestationParameters,
  XReserveAttestationResult,
  XReserveHttpResponse,
  XReserveHttpTransport,
} from './types/xreserve.js'
export type {
  AleoWalletClient,
  AleoHyperlaneGasQuote,
  AleoHyperlaneTransferRemoteCall,
  AleoHyperlaneTransferRemoteExecution,
  ExecuteAleoHyperlaneTransferRemoteParameters,
  ExecuteXReserveBurnParameters,
  ExecuteXReservePrivateMintParameters,
  XReserveBurnCall,
  XReserveBurnExecution,
  XReserveBurnMode,
  XReservePrivateMintExecution,
} from './types/aleo.js'
export type {
  SolanaHyperlaneRouteMetadata,
  SolanaHyperlaneTransferExecution,
  SolanaHyperlaneTransferQuote,
} from './types/solana.js'

export {
  aleoAddressToBytes32,
  aleoProgramAddress,
  buildXReserveDepositPayload,
  buildXReserveHookData,
  calculateXReserveDepositNonce,
  calculateXReserveMessageHash,
  evmAddressToXReserveBytes32,
  xReserveHexToAleoBytes,
} from './utils/xreserve.js'
export {
  evmAddressToAleoHyperlaneRecipient,
  solanaAddressToAleoHyperlaneRecipient,
} from './utils/hyperlane.js'

export { BridgeError } from './errors/bridgeErrors.js'
export { parseDecimalAmount } from './utils/units.js'
