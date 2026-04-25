/**
 * Types defined by the Provable wallet standard.
 *
 * A drift test in `packages/core/test/types/wallet.drift.test.ts` enforces
 * structural compatibility against `@provablehq/aleo-types` at typecheck time.
 */

/** Supported Aleo networks. */
export type Network = 'mainnet' | 'testnet' | 'canary'

/** Response shape returned when querying a transaction's status. */
export interface TransactionStatusResponse {
  /** Current transaction status (e.g. 'pending', 'finalized', 'rejected'). */
  status: string
  /** The on-chain transaction id, if the transaction has been accepted. */
  transactionId?: string
  /** Error message if the transaction failed. */
  error?: string
}

/** Response shape returned when requesting transaction history for a program. */
export interface TxHistoryResult {
  transactions: Array<{
    transactionId: string
    id: string
  }>
}
