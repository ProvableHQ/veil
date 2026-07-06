// ---------- Stage / step enums ----------

/**
 * Top-level lifecycle stage of a bridge order. Returned in
 * BridgeOrderStatusDto.status as a string.
 */
export type BridgeOrderStage =
  | 'NEW'
  | 'WAITING'
  | 'CONFIRMING'
  | 'EXCHANGING'
  | 'ANONYMIZING'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'FAILED'
  | 'REFUNDED'
  | 'DELETED'

/**
 * Workflow step key — describes the deposit_v1 workflow steps, distinct
 * from the higher-level BridgeOrderStage.
 */
export type BridgeOrderStepKey =
  | 'ORDER_CREATED'
  | 'AWAITING_DEPOSIT'
  | 'DEPOSIT_DETECTED'
  | 'DEPOSIT_CONFIRMED'
  | 'SWAP_IN_PROGRESS'
  | 'DESTINATION_SENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'EXPIRED'

export type BridgeOrderStepStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'

export type BridgeIntegrationType = 'CEX' | 'DEX'

// ---------- Provider ----------

export type ProviderSummary = {
  id: string
  code: string
  displayName: string
  capabilities: unknown[]
  website?: string
  supportUrl?: string
  logoUrl?: string
  logoUrlPng?: string
  supportedRegions?: string[]
  supportedCountries?: string[]
  supportedPaymentMethods?: string[]
}

export type ProviderStatusSnapshot = {
  code?: string | number
  text?: string
  txHash?: string
  reason?: string
  lastUpdatedAt?: string
}

// ---------- Quote ----------

export type BridgeQuoteFeeEstimateLeg = {
  amountInUsd?: string
  amountOutUsd?: string
  feeUsd?: string
}

export type BridgeQuoteFeeEstimate = {
  provider?: BridgeQuoteFeeEstimateLeg
  pricing?: BridgeQuoteFeeEstimateLeg
  appFeeBps?: number
  appFeeAmountIn?: string
}

export type BridgeQuoteMetadata = {
  quoteId?: string
  integrationType?: string
  amountInAtomic?: string
  amountOutAtomic?: string
  minAmountOutAtomic?: string
  amountInUsd?: string | number | null
  amountOutUsd?: string | number | null
  appFeeBps?: number
  [key: string]: unknown
}

export type BridgeQuote = {
  provider: ProviderSummary
  quoteId?: string
  quoteOptionId?: string
  integrationType?: BridgeIntegrationType
  srcChain: string
  destChain: string
  srcAsset: string
  destAsset: string
  destChainWalletValidationRegex?: string | null
  amountIn: string
  amountOut: string
  minAmountOut?: string
  feeEstimate?: BridgeQuoteFeeEstimate
  feeData?: Record<string, unknown>
  estimatedTimeSeconds?: number
  metadata?: BridgeQuoteMetadata
}

export type GetQuotesMeta = {
  count: number
  quoteRequestId: string
  warnings?: string[]
  providerErrors?: Record<string, unknown>
}

// ---------- Deposit instructions / order create response ----------

export type DepositInstructionType = 'ONCHAIN_DEPOSIT' | 'OFFCHAIN_WIDGET'

export type DepositInstruction = {
  type: DepositInstructionType
  chain?: string
  assetSymbol?: string
  assetDecimals?: number
  amount?: string
  address?: string
  memo?: string
  expiresAt?: string
  providerOrderId?: string
}

export type BridgeOrderInstructions = {
  orderId: string
  providerOrderId?: string
  depositAddress?: string
  depositMemo?: string
  depositAmount?: string
  depositAsset?: string
  depositChain?: string
  depositAssetSymbol?: string
  instructions?: DepositInstruction
  calldata?: Record<string, unknown>
  expiration?: string
  estimatedTimeSeconds?: number
  metadata?: Record<string, unknown>
}

// ---------- Order status / audit ----------

export type BridgeOrderStepStatusDto = {
  key: BridgeOrderStepKey
  status: BridgeOrderStepStatus
  startedAt?: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

export type BridgeOrderTimelineEventStage =
  | 'ORDER_CREATED'
  | 'DEPOSIT_PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'EXPIRED'

export type BridgeOrderTimelineEvent = {
  stage: BridgeOrderTimelineEventStage
  status: string
  occurredAt: string
  details?: Record<string, unknown>
}

export type BridgeOrderFinalStatusReason = {
  code: string
  message: string
  source: 'provider' | 'system'
  raw?: string
}

export type BridgeOrderFinalStatus = {
  key: BridgeOrderStepKey
  status: BridgeOrderStepStatus
  occurredAt?: string
  reason?: BridgeOrderFinalStatusReason
}

export type BridgeOrderStatusDto = {
  orderId: string
  provider: ProviderSummary
  providerOrderId?: string
  /** Carries BridgeOrderStage values; OpenAPI types it as `string`. */
  status: string
  providerStatus?: ProviderStatusSnapshot
  depositInstructions?: DepositInstruction
  timeline: BridgeOrderTimelineEvent[]
  finalStatus?: BridgeOrderFinalStatus
  workflowVersion?: string
  currentStepKey?: BridgeOrderStepKey
  steps?: BridgeOrderStepStatusDto[]
  quoteId?: string
  quoteRequest?: Record<string, unknown>
  quote?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type BridgeOrderProviderEventDto = {
  id: string
  providerCode: string
  providerStatusCode?: string
  providerStatusText?: string
  providerTxHash?: string
  genericStage?: string
  stepKey?: string
  rawPayload?: Record<string, unknown>
  observedAt: string
  source: string
  createdAt: string
}

export type BridgeOrderAuditDto = BridgeOrderStatusDto & {
  steps: BridgeOrderStepStatusDto[]
  providerEvents: BridgeOrderProviderEventDto[]
}

// ---------- Asset catalog ----------

/**
 * A provider's support entry on an asset, from `GET /common/assets`.
 *
 * @property providerId Provider id, usable as `createOrder`'s `providerId`.
 * @property providerCode Provider code (`NEAR_INTENTS`, `HALLIDAY`, `HOUDINI`).
 * @property integrationType How the provider routes this asset.
 */
export type AssetProviderSupport = {
  providerId: string
  providerCode: string
  integrationType?: BridgeIntegrationType
}

/**
 * One entry of the bridge's asset catalog (`GET /common/assets`) — the
 * source of truth for the identifiers every other call takes.
 *
 * @property id The asset's registry id.
 * @property code Chain-qualified asset code (`ALEO_MAINNET`, `USDC_ETH`) —
 *   what `srcAsset`/`destAsset` expect. Never a bare symbol.
 * @property chain Chain identifier (`ALEO`, `SOLANA`, `EVM:1`, `BITCOIN`) —
 *   what `srcChain`/`destChain` expect. Case-sensitive.
 * @property symbol Display symbol (`ALEO`, `USDC`).
 * @property decimals Display decimals; amounts are decimal strings with at
 *   most this precision.
 * @property native Whether the asset is the chain's native token.
 * @property walletValidationRegex Regex a recipient address on this asset's
 *   chain must match, when the API defines one.
 * @property supportedProviders Which providers can route this asset — an
 *   empty/absent list means no current routes touch it.
 * @property displayName Human-readable name, when set.
 * @property description Longer description, when set.
 * @property coingeckoId CoinGecko id for price lookups.
 * @property assetIconUrl Asset icon.
 * @property chainIconUrl Chain badge icon; null for native assets.
 */
export type BridgeAssetSummary = {
  id: string
  code: string
  chain: string
  symbol: string
  decimals: number
  native: boolean
  walletValidationRegex?: string | null
  supportedProviders?: AssetProviderSupport[]
  displayName?: string
  description?: string
  coingeckoId?: string
  assetIconUrl?: string
  chainIconUrl?: string | null
}

// ---------- Feature flags ----------

/**
 * Server-side feature flags for the bridge, from `GET /bridge/flags`.
 *
 * Field names are snake_case to match the wire format.
 *
 * @property near_supports_pub_priv_swaps Whether the NEAR provider currently
 *   supports public → private swaps. When false, a UI should not offer a
 *   private Aleo destination on NEAR-routed pairs.
 */
export type BridgeFlagsDto = {
  near_supports_pub_priv_swaps: boolean
}

// ---------- Terminal stage helper ----------

export const TERMINAL_STAGES = [
  'COMPLETED',
  'EXPIRED',
  'FAILED',
  'REFUNDED',
  'DELETED',
] as const

export type TerminalStage = (typeof TERMINAL_STAGES)[number]

export function isTerminalStage(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage)
}
