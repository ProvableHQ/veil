import type { BridgePlan } from './protocol.js'

/**
 * Records the token fee deducted from a private outbound transfer.
 * @property grossAmountAtomic Contains the positive gross token spend in local base units (u128).
 * @property protocolFeeAtomic Contains the included token fee, rounded down in local base units (u128).
 * @property netAmountAtomic Contains the amount bridged after deducting the fee, in local base units (u128).
 * @example const amounts: HyperlanePrivateTransferAmount = { grossAmountAtomic: 10000n, protocolFeeAtomic: 25n, netAmountAtomic: 9975n }
 */
export type HyperlanePrivateTransferAmount = {
  grossAmountAtomic: bigint
  protocolFeeAtomic: bigint
  netAmountAtomic: bigint
}

/**
 * Separates token funding from private dispatch credits and Aleo execution fees.
 * @property feeBps Contains the token fee rate from 0 through 9999 basis points.
 * @property tokenRecordAmountAtomic Contains the gross token record requirement; the protocol fee is already included.
 * @property dispatchCreditsRecordMicrocredits Contains the sum of both private dispatch hook payments (u64).
 * @property executionFeeMicrocredits Contains the separate Aleo execution fee (u64), or null when an authorized execution has not priced it.
 * @property totalMicrocredits Contains dispatch plus execution credits, or null when the execution fee is unknown. Token fees are denominated separately.
 * @example const fees: HyperlanePrivateTransferFees = { grossAmountAtomic: 10000n, protocolFeeAtomic: 25n, netAmountAtomic: 9975n, feeBps: 25, tokenRecordAmountAtomic: 10000n, dispatchCreditsRecordMicrocredits: 100n, executionFeeMicrocredits: null, totalMicrocredits: null }
 */
export type HyperlanePrivateTransferFees = HyperlanePrivateTransferAmount & {
  feeBps: number
  tokenRecordAmountAtomic: bigint
  dispatchCreditsRecordMicrocredits: bigint
  executionFeeMicrocredits: bigint | null
  totalMicrocredits: bigint | null
}

/**
 * Selects an outbound transfer for private fee accounting without authorizing execution.
 * @property plan Supplies an Aleo-origin Hyperlane plan; its amount is the gross token spend.
 * @example const params: QuoteAleoHyperlanePrivateTransferParameters = { plan }
 */
export type QuoteAleoHyperlanePrivateTransferParameters = { plan: BridgePlan }

/**
 * Reports live token and hook fees for the reviewed private-outbound ABI.
 * Does not enable or authorize `transfer_remote_private` execution.
 * @property routeId Identifies the reviewed outbound route.
 * @property program Identifies the Aleo warp whose private token fee was read.
 * @property amountIn Contains the gross display amount spent from the token record.
 * @property amountOut Contains the net destination display amount after token fees and decimal conversion.
 * @property destinationAmountAtomic Contains the net destination amount in remote base units (u256).
 * @property hookPayments Contains each effective and required hook invocation in order, including duplicates.
 * @property hookPayments.hook Identifies the hook receiving this payment.
 * @property hookPayments.paymentMicrocredits Contains the hook's current credits requirement (u64).
 * @example const quote: AleoHyperlanePrivateTransferQuote = await hyperlane.aleo.quotePrivateTransfer(client, { registry, plan })
 */
export type AleoHyperlanePrivateTransferQuote = HyperlanePrivateTransferFees & {
  routeId: string
  program: string
  amountIn: string
  amountOut: string
  destinationAmountAtomic: bigint
  hookPayments: readonly { hook: string; paymentMicrocredits: bigint }[]
}
