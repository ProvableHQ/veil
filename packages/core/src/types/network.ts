/**
 * Types for endpoints that aren't defined in the Aleo SDK — derived from live samples
 * against `https://api.provable.com/v2/mainnet/...`.
 *
 * These cover summaries, metrics, staking, supply, and token data served by the
 * explorer-side API. snake_case matches the wire; numeric widths follow the repo rule
 * (`number` for u64 and below, `bigint` for u128+).
 */

// ---------- Summaries ----------

export type BlockSummary = {
  block_height: number
  block_hash: string
  solution_count: number
  transaction_count: number
  /** unix seconds, as a string on the wire */
  block_timestamp: string
  /** u64 */
  coinbase_target: number
  /** u64 */
  proof_target: number
}

export type TransactionSummary = {
  /** at1... transaction id */
  id: string
  /** microcredits */
  fee: number
  /** "Accepted" | "Rejected" (capitalized on this endpoint) */
  status: string
  block_height: number
  /** unix seconds, as a string on the wire */
  block_timestamp: string
  block_hash: string
  /** "Execute" | "Deploy" | "Fee" (capitalized) */
  transaction_type: string
  program_id: string
  function_id: string
}

export type TransitionSummary = {
  /** au1... transition id */
  id: string
  /** "Accepted" | "Rejected" */
  transaction_status: string
  block_height: number
  /** at1... */
  transaction_id: string
  program_id: string
  function_id: string
  /** Amount involved, as a decimal string (credits.aleo transfers). */
  amount: string
  /** unix seconds — numeric on this endpoint */
  block_timestamp: number
  sender_address?: string
  recipient_address?: string
}

// ---------- Committee / staking ----------

/**
 * Validator entry in the committee map.
 *
 * Tuple shape: [stake_microcredits, is_open, commission_percent].
 * - stake is u64 — number (per repo rule)
 * - is_open: bool
 * - commission: u8 — number
 */
export type CommitteeMember = [number, boolean, number]

export type Committee = {
  /** Committee id (field element). */
  id: string
  starting_round: number
  members: Record<string, CommitteeMember>
}

export type StakingEarnings = {
  /** microcredits, cumulative */
  total_rewards: number
  /** Block height at which earnings were computed. */
  at_block: number
}

// ---------- Metrics ----------

export type TransactionMetricPoint = {
  /** ISO-8601 day bucket, e.g. "2026-04-20T00:00:00.000Z" */
  day: string
  count: number
}

export type ProgramMetricPoint = {
  program_id: string
  calls: number
}

export type ValidatorApy = {
  validator: string
  /** Decimal APY (e.g. 10.89 for ~10.89%). */
  apy: number
}

// ---------- DeFi / supply ----------

export type TvlEntry = {
  protocol_name: string
  /** Total value locked, in credits (not microcredits). */
  total_value: number
}

// ---------- Tokens ----------

export type Pagination = {
  limit: number
  offset: number
  total_count: number
  has_next: boolean
  has_previous: boolean
}

export type TokenInfo = {
  token_id: string
  token_id_datatype: string
  symbol: string
  display: string
  program_name: string
  decimals: number
  /** Stringified decimal (may exceed safe integer range). */
  total_supply: string
  verified: boolean
  token_icon_url: string | null
  compliance_freeze_list: unknown | null
  /** Stringified decimal price in quote currency. */
  price: string | null
  price_change_percentage_24h: string | null
  fully_diluted_value: string | null
  total_market_cap: string | null
  volume_24h: string | null
}

export type TokenPage = {
  pagination: Pagination
  data: TokenInfo[]
}
