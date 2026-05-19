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
