import type { TransactionInput } from '@provablehq/veil-core'
import type {
  AleoHyperlaneGasQuote,
  AleoHyperlaneTransferRemoteExecution,
  XReserveBurnExecution,
  XReserveBurnMode,
} from './aleo.js'
import type { EvmHyperlaneTransferExecution, EvmHyperlaneTransferQuote } from './evm.js'
import type {
  BridgeTransferPlan,
  BridgeTransferQuote,
  BridgeTransferReceipt,
} from './protocol.js'
import type { SolanaHyperlaneTransferExecution, SolanaHyperlaneTransferQuote } from './solana.js'
import type { EvmXReserveTransferExecution, EvmXReserveTransferQuote } from './xreserve.js'

/**
 * Selects a prepared transfer for a live protocol quote.
 *
 * @property plan Pure transfer plan returned by `prepareTransfer`.
 */
export type QuoteTransferParameters = {
  plan: BridgeTransferPlan
}

/** Identifies the route implementation that produced a transfer quote. */
export type TransferQuoteKind =
  | 'aleo-hyperlane'
  | 'aleo-xreserve'
  | 'evm-hyperlane'
  | 'evm-xreserve'
  | 'solana-hyperlane'

/** Captures every quote returned by the protocol-neutral transfer action. */
export type TransferQuote =
  | ({ kind: 'aleo-hyperlane' } & AleoHyperlaneGasQuote)
  | ({ kind: 'aleo-xreserve' } & BridgeTransferQuote)
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
 * @property plan Pure transfer plan returned by `prepareTransfer`.
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
export type ExecuteTransferParameters = {
  plan: BridgeTransferPlan
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
  resume?: BridgeTransferReceipt | undefined
  onSubmitted?: ((receipt: BridgeTransferReceipt) => void | Promise<void>) | undefined
  mode?: 'caller' | 'signer' | XReserveBurnMode | undefined
  userRecord?: TransactionInput | undefined
  merkleProof?: string | undefined
  privateFee?: boolean | undefined
  gasPaymentMicrocredits?: bigint | undefined
}

/** Identifies the route implementation that submitted a transfer. */
export type TransferExecutionKind =
  | 'aleo-hyperlane'
  | 'aleo-xreserve'
  | 'evm-hyperlane'
  | 'evm-xreserve'
  | 'solana-hyperlane'

/** Captures every result returned by the protocol-neutral execution action. */
export type TransferExecution =
  | ({ kind: 'aleo-hyperlane' } & AleoHyperlaneTransferRemoteExecution)
  | ({ kind: 'aleo-xreserve' } & XReserveBurnExecution)
  | ({ kind: 'evm-hyperlane' } & EvmHyperlaneTransferExecution)
  | ({ kind: 'evm-xreserve' } & EvmXReserveTransferExecution)
  | ({ kind: 'solana-hyperlane' } & SolanaHyperlaneTransferExecution)
