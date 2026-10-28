import type { EvmCctpTransferQuote, EvmCctpTransferExecution } from './cctp.js'
import type { ProvingProgressHandler, TransactionInput } from '@provablehq/veil-core'
import type { ComplianceProofs } from './compliance.js'
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
import type { EvmXReserveTransferExecution, EvmXReserveTransferQuote, WalletPreparedXReserveDeposit } from './xreserve.js'
import type { XReservePrivateMintIdentityStore } from '../utils/xreservePrivateMintStore.js'

/**
 * Groups the options specific to Circle's protocols: CCTP for native USDC and
 * xReserve for USDCx on Aleo.
 *
 * Each action accepts the subset that applies to it under its `circle` key.
 * A private xReserve mint takes exactly one nonce source: the identity store,
 * a wallet preparation, or the legacy secret scalar.
 *
 * @property manualMint Mints an attested, unused CCTP message directly when forwarding stalls. Defaults to waiting for forwarding.
 * @property approvalReplacement Confirmed CCTP approval that superseded a missing original. Recovery verifies the replacement without signing.
 * @property privateMintIdentities Store that reserves and resolves locally derived xReserve private mint identities. Defaults to the store configured on the bridge client. Standalone actions require an explicit shared store before deriving an identity or looking up its scalar.
 * @property privateMintAddressCommitment Public 32-byte commitment of a reserved identity, as lowercase hex. Defaults to the commitment carried by a quoted plan and must match it when both are present. Safe to checkpoint.
 * @property privateMintSecretNonce Legacy caller-managed Aleo scalar committed by a private xReserve deposit. Never persisted in a checkpoint.
 * @property walletPreparedDeposit Durably saved public wallet preparation. Replaces local commitment derivation.
 * @property privateMintNonceInput Wallet-derived nonce request bound to the preparation. Required with `walletPreparedDeposit` on completion; accepted earlier only for validation.
 */
export type CircleOptions = {
  manualMint?: boolean | undefined
  approvalReplacement?: { originalTransactionId: string; replacementTransactionId: string } | undefined
  privateMintIdentities?: XReservePrivateMintIdentityStore | undefined
  privateMintAddressCommitment?: string | undefined
  privateMintSecretNonce?: string | undefined
  walletPreparedDeposit?: WalletPreparedXReserveDeposit | undefined
  privateMintNonceInput?: TransactionInput | undefined
}

/** Circle options accepted while quoting a transfer. */
export type QuoteCircleOptions = Pick<CircleOptions,
  'privateMintIdentities' | 'privateMintAddressCommitment' | 'privateMintSecretNonce' | 'walletPreparedDeposit' | 'privateMintNonceInput'>

/** Circle options accepted while executing a transfer. */
export type ExecuteCircleOptions = QuoteCircleOptions

/** Circle options accepted while resuming an unfinished source transaction. */
export type ResumeCircleOptions = Pick<CircleOptions,
  'privateMintSecretNonce' | 'walletPreparedDeposit' | 'privateMintNonceInput'>

/** Circle options accepted while completing a transfer on its destination. */
export type CompleteCircleOptions = Pick<CircleOptions,
  'manualMint' | 'privateMintIdentities' | 'privateMintSecretNonce' | 'walletPreparedDeposit' | 'privateMintNonceInput'>

/** Circle options accepted while recovering a transfer from a checkpoint. */
export type CircleRecoveryOptions = Pick<CircleOptions, 'approvalReplacement'>

/**
 * Describes the cross-chain transfer whose current cost is calculated.
 *
 * The same source, destination, amount, and recipient become the plan returned
 * with the quote, so the caller can execute exactly what was priced.
 *
 * @property circle Circle-specific options: the identity store, a reserved commitment, a wallet preparation, or the legacy secret nonce for a private xReserve mint.
 * @property privateMintSecretNonce Legacy secret Aleo scalar committed by a private xReserve deposit.
 */
export type QuoteParameters = PrepareParameters & {
  circle?: QuoteCircleOptions | undefined
  /** @deprecated Use `circle.privateMintSecretNonce`. Removed in the next major release. */
  privateMintSecretNonce?: string | undefined
}

/** Identifies the route implementation that produced a transfer quote. */
export type BridgeQuoteKind =
  | 'aleo-hyperlane'
  | 'aleo-xreserve'
  | 'evm-hyperlane'
  | 'evm-cctp'
  | 'evm-xreserve'
  | 'solana-hyperlane'

/**
 * Reports configured or live-estimated fees for an Aleo-origin xReserve burn.
 *
 * Routes with a configured fee endpoint return `quoted`; fixed-fee routes
 * return `not-queried`. Live estimates do not impose an on-chain fee cap.
 *
 * @property kind Aleo-origin xReserve route discriminator.
 * @property routeId Directional route selected by the plan.
 * @property protocol Circle xReserve protocol discriminator.
 * @property amountIn Decimal source amount.
 * @property amountOut Decimal expected destination amount after the withdrawal fee.
 * @property fees Fee categories known during preparation.
 * @property status Distinguishes live provider estimates from configured fees.
 */
type AleoXReserveQuote = {
  kind: 'aleo-xreserve'
  routeId: string
  protocol: 'xreserve'
  amountIn: string
  amountOut?: string | undefined
  fees: BridgeFee[]
  status: 'not-queried' | 'quoted'
}

/** Captures every quote returned by the protocol-neutral transfer action. */
export type BridgeQuote = ({ plan: BridgePlan }) & (
  | ({ kind: 'aleo-hyperlane' } & AleoHyperlaneGasQuote)
  | AleoXReserveQuote
  | ({ kind: 'evm-hyperlane' } & EvmHyperlaneTransferQuote)
  | ({ kind: 'evm-cctp' } & EvmCctpTransferQuote)
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
 * @property merkleProof Optional single compliance bundle, annotated proofs, provider, or signer-only wallet request for a private Aleo xReserve burn. Null or omission enables local generation or wallet derivation; wallets require a matching grant.
 * @property privateFee Whether an Aleo wallet pays its execution fee privately. Defaults to false.
 * @property gasPaymentMicrocredits Optional exact Aleo Hyperlane hook payment override. Defaults to a fresh live quote.
 * @property circle Circle-specific options: the identity store, a reserved commitment, a wallet preparation, or the legacy secret nonce for a private xReserve mint. A quoted plan already carries its reserved commitment.
 * @property privateMintSecretNonce Legacy secret Aleo scalar committed by a private xReserve deposit.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries. Non-Aleo routes emit no events.
 */
export type ExecuteParameters = {
  plan: BridgePlan
  circle?: ExecuteCircleOptions | undefined
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
  onCheckpoint?: ((checkpoint: BridgeCheckpoint) => void | Promise<void>) | undefined
  mode?: 'caller' | 'signer' | XReserveBurnMode | undefined
  userRecord?: TransactionInput | undefined
  merkleProof?: ComplianceProofs | undefined
  privateFee?: boolean | undefined
  gasPaymentMicrocredits?: bigint | undefined
  /** @deprecated Use `circle.privateMintSecretNonce`. Removed in the next major release. */
  privateMintSecretNonce?: string | undefined
  onProgress?: ProvingProgressHandler | undefined
}

/** Identifies the route implementation that submitted a transfer. */
export type BridgeExecutionKind =
  | 'aleo-hyperlane'
  | 'aleo-xreserve'
  | 'evm-hyperlane'
  | 'evm-cctp'
  | 'evm-xreserve'
  | 'solana-hyperlane'

/** Captures every result returned by the protocol-neutral execution action. */
export type BridgeExecution =
  | ({ kind: 'aleo-hyperlane' } & AleoHyperlaneTransferRemoteExecution)
  | ({ kind: 'aleo-xreserve' } & XReserveBurnExecution)
  | ({ kind: 'evm-hyperlane' } & EvmHyperlaneTransferExecution)
  | ({ kind: 'evm-cctp' } & EvmCctpTransferExecution)
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
 * Controls the destination wallet transaction for xReserve private delivery or CCTP minting.
 *
 * @property circle Circle-specific options: the CCTP manual-mint override, or the identity store, wallet preparation and nonce input, or legacy secret nonce for a private xReserve mint.
 * @property cctp Manual-mint override for an attested, unused CCTP message when forwarding stalls.
 * @property privateMintSecretNonce Legacy caller-managed secret Aleo scalar for a private xReserve mint.
 * @property privateFee Whether the Aleo wallet pays its fee privately. Defaults to false.
 * @property onCheckpoint Durable hook called before supported local Aleo broadcast and again after destination submission.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries.
 */
type CompleteOptions = {
  circle?: CompleteCircleOptions | undefined
  /** @deprecated Use `circle.manualMint`. Removed in the next major release. */
  cctp?: { manualMint: boolean } | undefined
  /** @deprecated Use `circle.privateMintSecretNonce`. Removed in the next major release. */
  privateMintSecretNonce?: string | undefined
  privateFee?: boolean | undefined
  onCheckpoint?: ((checkpoint: BridgeCheckpoint) => void | Promise<void>) | undefined
  onProgress?: ProvingProgressHandler | undefined
}

/**
 * Supplies transfer state and wallet preferences for destination completion.
 *
 * An application returning after an interruption passes recovered progress. An
 * application that stayed open passes the original transfer details and latest
 * receipt. A CCTP transfer still waiting for forwarding may be completed early
 * only with `circle.manualMint` set to true.
 *
 * @property progress Recovered progress whose next operation is `complete`, or `wait` when manually minting CCTP.
 * @property plan Route, assets, amount, and recipient retained while the application stayed open.
 * @property receipt Circle-attested transfer state retained while the application stayed open.
 * @property circle Circle-specific options: the CCTP manual-mint override, or the identity store, wallet preparation and nonce input, or legacy secret nonce for a private xReserve mint.
 * @property cctp Manual-mint override for an attested, unused CCTP message when forwarding stalls.
 * @property privateMintSecretNonce Legacy caller-managed secret Aleo scalar for a private xReserve mint.
 * @property privateFee Whether the Aleo wallet pays its fee privately. Defaults to false.
 * @property onCheckpoint Optional durable hook called before supported local Aleo broadcast and again after destination submission.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries.
 */
export type CompleteParameters = CompleteOptions & (
  | { progress: Extract<BridgeProgress, { next: 'complete' }>, plan?: never, receipt?: never }
  | { progress: Extract<BridgeProgress, { next: 'wait' }>, circle: CompleteCircleOptions & { manualMint: true }, plan?: never, receipt?: never }
  /** @deprecated Use `circle: { manualMint: true }`. Removed in the next major release. */
  | { progress: Extract<BridgeProgress, { next: 'wait' }>, cctp: { manualMint: true }, plan?: never, receipt?: never }
  | { progress?: never, plan: BridgePlan, receipt: BridgeReceipt }
)

/**
 * Supplies saved public transfer information for recovery after an interruption.
 *
 * @property checkpoint Compact checkpoint emitted at a wallet submission boundary.
 * @property circle Circle-specific options: an explicit CCTP approval replacement for a missing original transaction, verified without signing. Defaults to no replacement.
 * @property cctp Explicit CCTP approval replacement for a missing original transaction.
 * @property signal Optional cancellation signal. Defaults to no cancellation.
 */
export type RecoverParameters = {
  checkpoint: BridgeCheckpoint
  circle?: CircleRecoveryOptions | undefined
  /** @deprecated Use `circle.approvalReplacement`. Removed in the next major release. */
  cctp?: { approvalReplacement: { originalTransactionId: string; replacementTransactionId: string } } | undefined
  signal?: AbortSignal | undefined
}

/**
 * Controls submission of a source-chain transaction left unfinished after an interruption.
 *
 * @property progress Recovery result whose next operation is `resume`.
 * @property circle Circle-specific options: the wallet preparation used by the original deposit, or the legacy secret nonce. Store-derived commitments resume from the checkpoint without either.
 * @property privateMintSecretNonce Legacy caller-managed Aleo scalar for resuming a legacy private xReserve deposit.
 * @property pollingIntervalMs Delay between source confirmation reads. Defaults to 1,000 milliseconds.
 * @property confirmationTimeoutMs Maximum source confirmation wait. Defaults to 120,000 milliseconds.
 * @property onCheckpoint Optional durable hook called immediately after a new transaction is broadcast.
 */
export type ResumeParameters = {
  progress: Extract<BridgeProgress, { next: 'resume' }>
  circle?: ResumeCircleOptions | undefined
  /** @deprecated Use `circle.privateMintSecretNonce`. Removed in the next major release. */
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
