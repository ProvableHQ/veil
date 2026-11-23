import type { Client, ProvingProgressHandler, TransactionInput } from '@provablehq/veil-core'
import type { BridgeCheckpoint, BridgePlan, BridgeReceipt } from './protocol.js'
import type { ComplianceProofs } from './compliance.js'

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
 * Requires explicit authorization through the separate private execution path.
 * @property routeId Identifies the reviewed outbound route.
 * @property program Identifies the Aleo warp whose private token fee was read.
 * @property amountIn Contains the gross display amount spent from the token record.
 * @property amountOut Contains the net destination display amount after token fees and decimal conversion.
 * @property destinationAmountAtomic Contains the net destination amount in remote base units (u256).
 * @property hookPayments Contains each effective and required hook invocation in order, including duplicates.
 * @property hookPayments.hook Identifies the hook receiving this payment.
 * @property hookPayments.paymentMicrocredits Contains the hook's current credits requirement (u64).
 * @property transferFingerprint Binds the quote to its intent and reviewed deployment. Omitted by older quote producers; execution requires a fresh SDK quote containing it.
 * @example const quote: AleoHyperlanePrivateTransferQuote = await hyperlane.aleo.quotePrivateTransfer(client, { registry, plan })
 */
export type AleoHyperlanePrivateTransferQuote = HyperlanePrivateTransferFees & {
  routeId: string
  program: string
  amountIn: string
  amountOut: string
  destinationAmountAtomic: bigint
  hookPayments: readonly { hook: string; paymentMicrocredits: bigint }[]
  transferFingerprint?: string | undefined
}

/**
 * Supplies funding for a recipient-reviewed private outbound quote.
 * @property quote Supplies the displayed SDK quote; execution rejects changed rates, hook payments, net amounts, or intent.
 * @property tokenRecord Optional Token plaintext or wallet record request. Defaults to wallet selection covering gross tokens, or local inventory selection.
 * @property dispatchCreditsRecord Optional credits plaintext or wallet record request. Defaults to selection covering both dispatch hooks.
 * @property recordClient Optional local account client used for inventory scans. Defaults to the signing wallet when it exposes a Veil transport; explicit record literals need no scanner.
 * @property merkleProof Optional signer compliance witness or provider. Omission generates local proofs or requests wallet derivation at input nine.
 * @property feeRecord Optional distinct local credits plaintext for private execution fees. Required with privateFee; wallet accounts use public execution fees.
 * @example const options: HyperlanePrivateTransferOptions = { quote }
 */
export type HyperlanePrivateTransferOptions = {
  quote: AleoHyperlanePrivateTransferQuote
  tokenRecord?: TransactionInput | undefined
  dispatchCreditsRecord?: TransactionInput | undefined
  recordClient?: Client | undefined
  merkleProof?: ComplianceProofs | undefined
  feeRecord?: string | undefined
}

/**
 * Selects inputs for an inspectable eleven-input private outbound call.
 * @property plan Supplies the gross amount and external-chain recipient.
 * @property quote Supplies a current intent-bound private quote.
 * @property tokenRecord Optional token plaintext or wallet request. Defaults to gross-amount wallet selection.
 * @property dispatchCreditsRecord Optional credits plaintext or wallet request. Defaults to wallet selection covering both hooks.
 * @property merkleProof Optional literal or signer-derived witness. Defaults to the reviewed freezelist request at input nine.
 * @example const params: BuildAleoHyperlanePrivateTransferParameters = { plan, quote }
 */
export type BuildAleoHyperlanePrivateTransferParameters = {
  plan: BridgePlan
  quote: AleoHyperlanePrivateTransferQuote
  tokenRecord?: TransactionInput | undefined
  dispatchCreditsRecord?: TransactionInput | undefined
  merkleProof?: TransactionInput | undefined
}

/**
 * Describes a separate private outbound call without changing public transfer call types.
 * @property program Identifies the reviewed private warp program.
 * @property function Identifies the eleven-input transition.
 * @property inputs Contains private records at zero and one, signer proofs at nine, and current u16 fee bps at ten.
 * @example const call: AleoHyperlanePrivateTransferCall = buildAleoHyperlanePrivateTransferCall(registry, { plan, quote })
 */
export type AleoHyperlanePrivateTransferCall = {
  program: string
  function: 'transfer_remote_private'
  inputs: TransactionInput[]
}

/**
 * Authorizes a quoted private outbound transfer with recoverable proving boundaries.
 * @property plan Supplies the original gross amount and external-chain recipient.
 * @property privateFee Uses a distinct local execution-fee record when true. Defaults to false; wallet accounts pay public execution fees.
 * @property skipRouteStatus Skips the generic route pause probes when already checked. Defaults to false; the private outbound pause mapping is always checked.
 * @property onCheckpoint Persists public recovery state before local broadcast and after submission. Defaults to no persistence.
 * @property onProgress Observes awaited proving and submission events. Defaults to no reporting.
 * @example const params: ExecuteAleoHyperlanePrivateTransferParameters = { plan, quote, onCheckpoint: save }
 */
export type ExecuteAleoHyperlanePrivateTransferParameters = HyperlanePrivateTransferOptions & {
  plan: BridgePlan
  privateFee?: boolean | undefined
  skipRouteStatus?: boolean | undefined
  onCheckpoint?: ((checkpoint: BridgeCheckpoint) => void | Promise<void>) | undefined
  onProgress?: ProvingProgressHandler | undefined
}

/**
 * Captures a submitted private outbound transfer without retaining record plaintext.
 * @property transactionId Identifies the submitted Aleo transaction.
 * @property receipt Retains source confirmation state and net destination balance verification.
 * @example const result: AleoHyperlanePrivateTransferExecution = await executeAleoHyperlanePrivateTransfer(registry, clients, params)
 */
export type AleoHyperlanePrivateTransferExecution = { transactionId: string; receipt: BridgeReceipt }
