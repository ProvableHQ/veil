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

export {
  getProtocolAssets as getAssets,
  type GetProtocolAssetsParameters as GetAssetsParameters,
} from './actions/getProtocolAssets.js'
export {
  getProtocolRoutes as getRoutes,
  type GetProtocolRoutesParameters as GetRoutesParameters,
} from './actions/getProtocolRoutes.js'
export { prepareTransfer } from './actions/prepareTransfer.js'
export { executeEvmHyperlaneTransfer } from './actions/executeEvmHyperlaneTransfer.js'
export { quoteEvmHyperlaneTransfer } from './actions/quoteEvmHyperlaneTransfer.js'
export { executeEvmXReserveTransfer } from './actions/executeEvmXReserveTransfer.js'
export { getXReserveAttestation } from './actions/getXReserveAttestation.js'
export { quoteEvmXReserveTransfer } from './actions/quoteEvmXReserveTransfer.js'
export { executeXReservePrivateMint } from './actions/executeXReservePrivateMint.js'
export { buildXReserveBurnCall } from './actions/buildXReserveBurnCall.js'
export { executeXReserveBurn } from './actions/executeXReserveBurn.js'
export { buildAleoHyperlaneTransferRemoteCall } from './actions/buildAleoHyperlaneTransferRemoteCall.js'
export { executeAleoHyperlaneTransferRemote } from './actions/executeAleoHyperlaneTransferRemote.js'
export { quoteAleoHyperlaneGasPayment } from './actions/quoteAleoHyperlaneGasPayment.js'
export { quoteSolanaHyperlaneTransfer } from './actions/quoteSolanaHyperlaneTransfer.js'
export { executeSolanaHyperlaneTransfer } from './actions/executeSolanaHyperlaneTransfer.js'

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
  AleoWalletClient,
  AleoHyperlaneGasQuote,
  AleoHyperlaneTransferRemoteCall,
  AleoHyperlaneTransferRemoteExecution,
  ExecuteAleoHyperlaneTransferRemoteParameters,
  ExecuteXReserveBurnParameters,
  ExecuteXReservePrivateMintParameters,
  QuoteAleoHyperlaneGasPaymentParameters,
  XReserveBurnCall,
  XReserveBurnExecution,
  XReserveBurnMode,
  XReservePrivateMintExecution,
} from './types/aleo.js'
export type {
  ExecuteSolanaHyperlaneTransferParameters,
  QuoteSolanaHyperlaneTransferParameters,
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
