/**
 * Block and related types, mirroring the Provable REST API wire format.
 *
 * Field names stay snake_case to match the SDK at `~/dev/sdk/sdk/src/models/blockJSON.ts`
 * and the raw HTTP response from `GET /{network}/block/{...}`. Numeric widths follow the
 * repo rule: `number` for u64 and smaller, `bigint` only for u128+ — with one exception
 * noted on the u128 fields below.
 */

export type Metadata = {
  /** u16 — network id */
  network: number
  /** u64 — consensus round */
  round: number
  /** u32 — block height */
  height: number
  /** u64 — coinbase puzzle target */
  coinbase_target: number
  /** u64 — prover solution target */
  proof_target: number
  /** u64 — coinbase_target of the most recent coinbase-producing block */
  last_coinbase_target: number
  /** i64 — unix seconds of the most recent coinbase-producing block */
  last_coinbase_timestamp: number
  /** i64 — unix seconds */
  timestamp: number
  /**
   * u128 — cumulative consensus weight.
   *
   * Despite the "bigint for u128" rule, this is delivered as a string on the wire
   * (JSON numbers can't losslessly represent u128). Callers can `BigInt(...)` it.
   */
  cumulative_weight: string
  /** u128 — cumulative proof target (string for the same reason as cumulative_weight). */
  cumulative_proof_target: string
}

export type Header = {
  previous_state_root: string
  transactions_root: string
  finalize_root: string
  ratifications_root: string
  solutions_root: string
  subdag_root: string
  metadata: Metadata
}

export type Ratification = {
  type: string
  amount: number
}

export type PartialSolution = {
  solution_id: string
  epoch_hash: string
  address: string
  /** u64 — puzzle nonce */
  counter: number
}

export type Solution = {
  partial_solution: PartialSolution
  /** u64 — solution target */
  target: number
}

export type Solutions = {
  /** u16 — solutions format version */
  version: number
  solutions?: Solution[]
}

export type Finalize = {
  type: string
  mapping_id: string
  key_id: string
  value_id: string
}

export type ConfirmedTransaction = {
  /** e.g. "accepted" | "rejected" */
  status: string
  /** e.g. "execute" | "deploy" | "fee" */
  type: string
  /** u32 — position within the block */
  index: number
  // Left as Record<string, unknown> at this layer; the fully typed shape is `Transaction`
  // from ./transaction.ts. Widening avoids a circular import and matches the wire, which
  // embeds the raw transaction JSON here.
  transaction: Record<string, unknown>
  finalize: Finalize[]
}

export type Block = {
  block_hash: string
  previous_hash: string
  header: Header
  /** Beacon / quorum authority for the block. Opaque shape — varies by consensus variant. */
  authority: Record<string, unknown>
  transactions?: ConfirmedTransaction[]
  ratifications: Ratification[]
  solutions: Solutions
  aborted_solution_ids: string[]
  aborted_transaction_ids: string[]
}
