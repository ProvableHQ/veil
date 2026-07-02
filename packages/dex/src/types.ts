/**
 * The serializable thread between a private swap's two transactions.
 *
 * `swapPrivate` returns it; `claimSwapOutputPrivate` consumes it. Plain JSON
 * on purpose — persist it (disk, DB) so a claim can happen after a crash or
 * from another process.
 *
 * @property swapId Swap id field literal (the request transition's first
 *   output). Present immediately on the local-signer path; on the wallet
 *   path it becomes known once the wallet's transaction confirms — resolve
 *   it from the transaction before claiming.
 * @property blindingFactor Secret field literal proving ownership at claim
 *   time. Present only on the local-signer path — a wallet keeps it private
 *   and re-derives it from `blindedAddress` at claim time. Treat like a key.
 * @property blindedAddress The public single-use address the swap recorded.
 *   Present immediately on the local-signer path; on the wallet path the
 *   wallet fills the slot, so recover it post-confirmation from the
 *   transition's public inputs (or the indexer's `swap.recipient`) before
 *   claiming.
 * @property tokenInId Token id (field literal) that was sold.
 * @property tokenOutId Token id (field literal) that was bought.
 * @property poolKey Pool the swap executed against.
 * @property amountIn Raw atomic amount sold (u128).
 * @property transactionId The request transaction's id.
 * @property program The shield_swap program the swap targets.
 */
export interface SwapHandle {
  swapId?: string
  blindingFactor?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  poolKey: string
  amountIn: bigint
  transactionId: string
  program: string
}
