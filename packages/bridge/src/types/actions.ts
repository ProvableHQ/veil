import type { ProvingProgressHandler, TransactionInput } from '@provablehq/veil-core'
import type {
  AleoHyperlaneGasQuote,
  AleoHyperlaneTransferRemoteExecution,
  XReserveBurnExecution,
  XReserveBurnMode,
} from './aleo.js'
import type { EvmHyperlaneTransferExecution, EvmHyperlaneTransferQuote } from './evm.js'
import type {
  BridgeFee,
  BridgeCheckpoint,
  BridgePlan,
  BridgeProgress,
  BridgeReceipt,
  BridgeStatus,
  PrepareParameters,
} from './protocol.js'
import type { SolanaHyperlaneTransferExecution, SolanaHyperlaneTransferQuote } from './solana.js'
import type { EvmXReserveTransferExecution, EvmXReserveTransferQuote } from './xreserve.js'

/**
 * Describes the cross-chain transfer whose current cost is calculated.
 *
 * The same source, destination, amount, and recipient become the plan returned
 * with the quote, so the caller can execute exactly what was priced.
 *
 * @property privateMintAddressCommitment Public 32-byte recipient commitment reserved by the bridge identity store. Safe to checkpoint.
 * @property privateMintSecretNonce Legacy secret Aleo scalar committed by a private xReserve deposit. Defaults to `0scalar` and is never persisted in a checkpoint.
 */
export type QuoteParameters = PrepareParameters & {
  privateMintAddressCommitment?: string | undefined
  privateMintSecretNonce?: string | undefined
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
export type BridgeQuote = ({ plan: BridgePlan }) & (
  | ({ kind: 'aleo-hyperlane' } & AleoHyperlaneGasQuote)
  | AleoXReserveQuote
  | ({ kind: 'evm-hyperlane' } & EvmHyperlaneTransferQuote)
  | ({ kind: 'evm-xreserve' } & EvmXReserveTransferQuote)
  | ({ kind: 'solana-hyperlane' } & SolanaHyperlaneTransferQuote)
)

/**
 * Controls how the source wallet begins a cross-chain transfer.
 *
 * Current fees and approval requirements are recalculated before funds are
 * committed, so a previously displayed quote is not treated as final.
 *
 * @property plan Route, assets, amount, and recipient selected for the transfer.
 * @property pollingIntervalMs Delay between source confirmation checks. Defaults to 1,000 milliseconds where polling applies.
 * @property confirmationTimeoutMs Maximum source confirmation wait. Defaults to 120,000 milliseconds where polling applies.
 * @property onCheckpoint Optional durable hook receiving compact recovery state before supported local Aleo broadcasts and after every submission.
 * @property mode Aleo Hyperlane caller mode or xReserve burn mode. Defaults to `caller` for Hyperlane and `private` for xReserve.
 * @property userRecord Wallet record request or encoded USDCx record required by a private Aleo xReserve burn.
 * @property merkleProof Encoded `[MerkleProof; 2]` literal required by a private Aleo xReserve burn.
 * @property privateFee Whether an Aleo wallet pays its execution fee privately. Defaults to false.
 * @property gasPaymentMicrocredits Optional exact Aleo Hyperlane hook payment override. Defaults to a fresh live quote.
 * @property privateMintAddressCommitment Public 32-byte recipient commitment reserved by the bridge identity store. Safe to checkpoint.
 * @property privateMintSecretNonce Legacy secret Aleo scalar committed by a private xReserve deposit. Defaults to `0scalar` and is never persisted in a checkpoint.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries. Non-Aleo routes emit no events.
 */
export type ExecuteParameters = {
  plan: BridgePlan
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
  onCheckpoint?: ((checkpoint: BridgeCheckpoint) => void | Promise<void>) | undefined
  mode?: 'caller' | 'signer' | XReserveBurnMode | undefined
  userRecord?: TransactionInput | undefined
  merkleProof?: string | undefined
  privateFee?: boolean | undefined
  gasPaymentMicrocredits?: bigint | undefined
  privateMintAddressCommitment?: string | undefined
  privateMintSecretNonce?: string | undefined
  onProgress?: ProvingProgressHandler | undefined
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
 * Supplies an in-progress cross-chain transfer for one status check.
 *
 * @property plan Route, assets, amount, and recipient for the transfer.
 * @property receipt Latest known state and submitted transaction identifiers.
 * @property signal Optional cancellation signal for protocol HTTP reads. Defaults to no cancellation.
 */
export type GetStatusParameters = {
  plan: BridgePlan
  receipt: BridgeReceipt
  signal?: AbortSignal | undefined
}

/**
 * Controls the wallet transaction that privately delivers USDCx on Aleo.
 *
 * @property privateMintSecretNonce Caller-managed secret Aleo scalar required when the bridge identity store did not derive the commitment.
 * @property privateFee Whether the Aleo wallet pays its fee privately. Defaults to false.
 * @property onCheckpoint Durable hook called before supported local Aleo broadcast and again after destination submission.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries.
 */
type CompleteOptions = {
  privateMintSecretNonce?: string | undefined
  privateFee?: boolean | undefined
  onCheckpoint?: ((checkpoint: BridgeCheckpoint) => void | Promise<void>) | undefined
  onProgress?: ProvingProgressHandler | undefined
}

/**
 * Supplies the state and wallet preferences required to receive private USDCx on Aleo.
 *
 * An application returning after an interruption passes recovered progress. An
 * application that stayed open passes the original transfer details and latest
 * receipt.
 *
 * @property progress Recovered progress whose next operation is `complete`.
 * @property plan Route, assets, amount, and recipient retained while the application stayed open.
 * @property receipt Circle-attested transfer state retained while the application stayed open.
 * @property privateMintSecretNonce Caller-managed secret Aleo scalar required when the bridge identity store did not derive the commitment.
 * @property privateFee Whether the Aleo wallet pays its fee privately. Defaults to false.
 * @property onCheckpoint Optional durable hook called before supported local Aleo broadcast and again after destination submission.
 */
export type CompleteParameters = CompleteOptions & (
  | { progress: Extract<BridgeProgress, { next: 'complete' }>, plan?: never, receipt?: never }
  | { progress?: never, plan: BridgePlan, receipt: BridgeReceipt }
)

/**
 * Supplies saved public transfer information for recovery after an interruption.
 *
 * @property checkpoint Compact checkpoint emitted at a wallet submission boundary.
 * @property signal Optional cancellation signal. Defaults to no cancellation.
 */
export type RecoverParameters = {
  checkpoint: BridgeCheckpoint
  signal?: AbortSignal | undefined
}

/**
 * Controls submission of a source-chain transaction left unfinished after an interruption.
 *
 * @property progress Recovery result whose next operation is `resume`.
 * @property privateMintSecretNonce Caller-managed Aleo scalar required to resume a legacy private xReserve deposit. Store-derived commitments resume from the checkpoint without it.
 * @property pollingIntervalMs Delay between source confirmation reads. Defaults to 1,000 milliseconds.
 * @property confirmationTimeoutMs Maximum source confirmation wait. Defaults to 120,000 milliseconds.
 * @property onCheckpoint Optional durable hook called immediately after a new transaction is broadcast.
 */
export type ResumeParameters = {
  progress: Extract<BridgeProgress, { next: 'resume' }>
  privateMintSecretNonce?: string | undefined
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
  onCheckpoint?: ((checkpoint: BridgeCheckpoint) => void | Promise<void>) | undefined
}

/**
 * Controls how a recovered cross-chain transfer is followed until it finishes or needs a wallet.
 *
 * @property progress Current transfer details, receipt, and required next operation.
 * @property until Optional protocol statuses that also stop polling. Defaults to wallet authorization and terminal boundaries.
 * @property pollingIntervalMs Delay between reads. Defaults to 15,000 milliseconds.
 * @property timeoutMs Maximum polling duration. Defaults to 1,200,000 milliseconds.
 * @property onUpdate Optional callback invoked after each receipt transition.
 * @property signal Optional cancellation signal. Defaults to no cancellation.
 */
export type WaitParameters = {
  progress: BridgeProgress
  until?: readonly BridgeStatus[] | undefined
  pollingIntervalMs?: number | undefined
  timeoutMs?: number | undefined
  onUpdate?: ((progress: BridgeProgress) => void | Promise<void>) | undefined
  signal?: AbortSignal | undefined
}
