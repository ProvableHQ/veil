// Clients
export {
  createBridgeClient,
  type BridgeClient,
  type BridgeClientConfig,
} from './clients/createBridgeClient.js'
export { bridgeActions, type BridgeActions } from './clients/decorators/bridge.js'

// Transport
export { httpBridge } from './transports/httpBridge.js'

// Actions (standalone forms)
export {
  getAssets,
  type GetAssetsReturnType,
} from './actions/getAssets.js'
export {
  getProviders,
  type GetProvidersReturnType,
} from './actions/getProviders.js'
export {
  getRoutes,
  type BridgeRouteCandidate,
  type GetRoutesParameters,
  type GetRoutesReturnType,
  type RouteAsset,
} from './actions/getRoutes.js'
export {
  getFlags,
  type GetFlagsReturnType,
} from './actions/getFlags.js'
export {
  getQuotes,
  type GetQuotesParameters,
  type GetQuotesReturnType,
} from './actions/getQuotes.js'
export {
  createOrder,
  type CreateOrderParameters,
  type CreateOrderReturnType,
} from './actions/createOrder.js'
export {
  getOrder,
  type GetOrderParameters,
  type GetOrderReturnType,
} from './actions/getOrder.js'
export {
  getOrderAudit,
  type GetOrderAuditParameters,
  type GetOrderAuditReturnType,
} from './actions/getOrderAudit.js'
export {
  waitForOrder,
  type WaitForOrderParameters,
  type WaitForOrderReturnType,
} from './actions/waitForOrder.js'
export {
  swap,
  type SwapParameters,
  type SwapReturnType,
} from './actions/swap.js'

// Types
export type {
  ApiEnvelope,
} from './types/envelope.js'
export type {
  AssetProviderSupport,
  BridgeAssetSummary,
  BridgeFlagsDto,
  BridgeIntegrationType,
  BridgeOrderAuditDto,
  BridgeOrderFinalStatus,
  BridgeOrderFinalStatusReason,
  BridgeOrderInstructions,
  BridgeOrderProviderEventDto,
  BridgeOrderStage,
  BridgeOrderStatusDto,
  BridgeOrderStepKey,
  BridgeOrderStepStatus,
  BridgeOrderStepStatusDto,
  BridgeOrderTimelineEvent,
  BridgeOrderTimelineEventStage,
  BridgeQuote,
  BridgeQuoteFeeEstimate,
  BridgeQuoteFeeEstimateLeg,
  BridgeQuoteMetadata,
  DepositInstruction,
  DepositInstructionType,
  GetQuotesMeta,
  ProviderStatusSnapshot,
  ProviderSummary,
  TerminalStage,
} from './types/bridge.js'
export { TERMINAL_STAGES, isTerminalStage } from './types/bridge.js'

// Errors
export {
  BridgeError,
  BridgeEnvelopeError,
  BridgeOrderFailedError,
  BridgeTimeoutError,
} from './errors/bridgeErrors.js'

// Utilities
export { unwrapEnvelope } from './utils/unwrapEnvelope.js'
export { parseDecimalAmount } from './utils/units.js'

// Asset routing
export {
  aleoAssetProgram,
  DEFAULT_ALEO_ASSET_MAP,
  type AleoAssetConfig,
} from './lib/aleo-asset.js'

// Chain display names (stopgap until the API exposes its chain registry)
export { chainDisplayName, KNOWN_CHAIN_NAMES } from './lib/chain-names.js'
