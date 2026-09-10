import type { TransactionInput } from '@provablehq/veil-core'
import type {
  AleoHyperlaneGasQuote,
  AleoHyperlaneTransferRemoteExecution,
  XReserveBurnExecution,
  XReserveBurnMode,
} from './aleo.js'
import type { EvmHyperlaneTransferExecution, EvmHyperlaneTransferQuote } from './evm.js'
import type {
  BridgeFee,
  BridgePlan,
  BridgeReceipt,
  BridgeStatus,
} from './protocol.js'
import type { SolanaHyperlaneTransferExecution, SolanaHyperlaneTransferQuote } from './solana.js'
import type { EvmXReserveTransferExecution, EvmXReserveTransferQuote } from './xreserve.js'

/**
 * Selects a prepared transfer for a live protocol quote.
 *
 * @property plan Pure transfer plan returned by `prepare`.
 */
export type QuoteParameters = {
  plan: BridgePlan
}

/** Identifies the route implementation that produced a transfer quote. */
export type BridgeQuoteKind =
  | 'aleo-hyperlane'
  | 'aleo-xreserve'
  | 'evm-hyperlane'
  | 'evm-xreserve'
  | 'solana-hyperlane'

/**
 * Reports the locally known values for an Aleo-origin xReserve burn.
 *
 * The route has no separate source-chain quote call, so the result carries
 * the prepared amount and fees with a `not-queried` status.
 *
 * @property kind Aleo-origin xReserve route discriminator.
 * @property routeId Directional route selected by the plan.
 * @property protocol Circle xReserve protocol discriminator.
 * @property amountIn Decimal source amount.
 * @property amountOut Decimal destination amount when locally determinable.
 * @property fees Fee categories known during preparation.
 * @property status Indicates that no live quote endpoint was queried.
 */
type AleoXReserveQuote = {
  kind: 'aleo-xreserve'
  routeId: string
  protocol: 'xreserve'
  amountIn: string
  amountOut?: string | undefined
  fees: BridgeFee[]
  status: 'not-queried'
}

/** Captures every quote returned by the protocol-neutral transfer action. */
export type BridgeQuote =
  | ({ kind: 'aleo-hyperlane' } & AleoHyperlaneGasQuote)
  | AleoXReserveQuote
  | ({ kind: 'evm-hyperlane' } & EvmHyperlaneTransferQuote)
  | ({ kind: 'evm-xreserve' } & EvmXReserveTransferQuote)
  | ({ kind: 'solana-hyperlane' } & SolanaHyperlaneTransferQuote)

/**
 * Configures the next source-chain execution for a prepared transfer.
 *
 * The route selects the required chain client and protocol implementation.
 * Execution requotes live values before submission rather than trusting a
 * previously displayed quote.
 *
 * @property plan Pure transfer plan returned by `prepare`.
 * @property pollingIntervalMs Delay between source confirmation checks. Defaults to 1,000 milliseconds where polling applies.
 * @property confirmationTimeoutMs Maximum source confirmation wait. Defaults to 120,000 milliseconds where polling applies.
 * @property resume Previously checkpointed source receipt. Applies to implementations that support verification-only resumption.
 * @property onSubmitted Durable checkpoint hook invoked immediately after a supported source transaction is broadcast.
 * @property mode Aleo Hyperlane caller mode or xReserve burn mode. Defaults to `caller` for Hyperlane and `private` for xReserve.
 * @property userRecord Wallet record request or encoded USDCx record required by a private Aleo xReserve burn.
 * @property merkleProof Encoded `[MerkleProof; 2]` literal required by a private Aleo xReserve burn.
 * @property privateFee Whether an Aleo wallet pays its execution fee privately. Defaults to false.
 * @property gasPaymentMicrocredits Optional exact Aleo Hyperlane hook payment override. Defaults to a fresh live quote.
 */
export type ExecuteParameters = {
  plan: BridgePlan
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
  resume?: BridgeReceipt | undefined
  onSubmitted?: ((receipt: BridgeReceipt) => void | Promise<void>) | undefined
  mode?: 'caller' | 'signer' | XReserveBurnMode | undefined
  userRecord?: TransactionInput | undefined
  merkleProof?: string | undefined
  privateFee?: boolean | undefined
  gasPaymentMicrocredits?: bigint | undefined
}

/** Identifies the route implementation that submitted a transfer. */
export type BridgeExecutionKind =
  | 'aleo-hyperlane'
  | 'aleo-xreserve'
  | 'evm-hyperlane'
  | 'evm-xreserve'
  | 'solana-hyperlane'

/** Captures every result returned by the protocol-neutral execution action. */
export type BridgeExecution =
  | ({ kind: 'aleo-hyperlane' } & AleoHyperlaneTransferRemoteExecution)
  | ({ kind: 'aleo-xreserve' } & XReserveBurnExecution)
  | ({ kind: 'evm-hyperlane' } & EvmHyperlaneTransferExecution)
  | ({ kind: 'evm-xreserve' } & EvmXReserveTransferExecution)
  | ({ kind: 'solana-hyperlane' } & SolanaHyperlaneTransferExecution)

/**
 * Selects a persisted transfer receipt for one read-only status refresh.
 *
 * @property plan Original plan that produced the receipt.
 * @property receipt Latest persisted lifecycle state.
 * @property signal Optional cancellation signal for protocol HTTP reads. Defaults to no cancellation.
 */
export type GetStatusParameters = {
  plan: BridgePlan
  receipt: BridgeReceipt
  signal?: AbortSignal | undefined
}

/**
 * Configures read-only polling until a requested lifecycle state is reached.
 *
 * @property plan Original plan that produced the receipt.
 * @property receipt Latest persisted lifecycle state.
 * @property until One or more statuses that stop polling.
 * @property pollingIntervalMs Delay between reads. Defaults to 15,000 milliseconds and is floored at 100 milliseconds.
 * @property timeoutMs Maximum polling duration. Defaults to 1,200,000 milliseconds.
 * @property onUpdate Durable callback invoked after each receipt state transition.
 * @property signal Optional cancellation signal. Defaults to no cancellation.
 */
export type WaitForStatusParameters = GetStatusParameters & {
  until: readonly BridgeStatus[]
  pollingIntervalMs?: number | undefined
  timeoutMs?: number | undefined
  onUpdate?: ((receipt: BridgeReceipt) => void | Promise<void>) | undefined
}

/**
 * Configures one caller-authorized destination-chain submission.
 *
 * @property plan Original plan that produced the ready receipt.
 * @property receipt Receipt whose status and next action authorize submission.
 * @property privateFee Whether an Aleo wallet pays the execution fee privately. Defaults to false.
 * @property onSubmitted Durable checkpoint hook invoked immediately after destination broadcast.
 */
export type CompleteParameters = {
  plan: BridgePlan
  receipt: BridgeReceipt
  privateFee?: boolean | undefined
  onSubmitted?: ((receipt: BridgeReceipt) => void | Promise<void>) | undefined
}
