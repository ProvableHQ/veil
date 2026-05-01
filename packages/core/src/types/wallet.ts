/**
 * Types defined by the Provable wallet standard.
 *
 * A drift test in `packages/core/test/types/wallet.drift.test.ts` enforces
 * structural compatibility against `@provablehq/aleo-types` at typecheck time.
 */

/**
 * Aleo network identifier. Known values are autocompleted; arbitrary strings
 * are accepted so new networks (or wallet-specific aliases) don't require a
 * type bump.
 */
export type Network = 'mainnet' | 'testnet' | (string & {})

/** Response shape returned when querying a transaction's status. */
export interface TransactionStatusResponse {
  /** Current transaction status (e.g. 'accepted', 'rejected', 'pending', 'not_found'). */
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
