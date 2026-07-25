import type { Client } from '@provablehq/veil-core'
import { readStructMapping } from './internal.js'
import { toPosition } from '../../generated/shield_swap.js'
import { fromU256Parts } from '../../utils/q128.js'

/**
 * Parameters for {@link getPosition}.
 *
 * @property positionTokenId The position's `token_id` field literal — the
 *   `positions` mapping key itself (no hashing). From `mint`'s return, a
 *   PositionNFT record, or `derivePositionTokenId`.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetPositionParameters = {
  positionTokenId: string
  program?: string
}

/**
 * A position's public state, with the chain's `{ hi, lo }` u256 struct
 * fields joined to plain `bigint`s.
 *
 * @property token_id The position's `token_id` field literal.
 * @property pool Pool key field literal the position belongs to.
 * @property tick_lower Lower bound of the range (i32).
 * @property tick_upper Upper bound of the range (i32).
 * @property liquidity Live liquidity in the range (u128).
 * @property fee_growth_inside0_last_x_128 Token0 fee growth inside the range
 *   at the last touch, Q128.128 (u256).
 * @property fee_growth_inside1_last_x_128 Token1 fee growth inside the range
 *   at the last touch, Q128.128 (u256).
 * @property tokens_owed0 Token0 owed to the position (u128, raw units).
 * @property tokens_owed1 Token1 owed to the position (u128, raw units).
 */
export interface Position {
  token_id: string
  pool: string
  tick_lower: number
  tick_upper: number
  liquidity: bigint
  fee_growth_inside0_last_x_128: bigint
  fee_growth_inside1_last_x_128: bigint
  tokens_owed0: bigint
  tokens_owed1: bigint
}

/** The decoded position, or `null` when no position exists under the id. */
export type GetPositionReturnType = Position | null

/**
 * Reads a position's public state from the on-chain `positions` mapping.
 *
 * Returns the range, live liquidity, fee-growth snapshots (Q128.128
 * `bigint`s, joined from the chain's `{ hi, lo }` u256 structs), and the
 * `tokens_owed` balances that `decreaseLiquidity` and fee accrual settle
 * into — the read that reconciles a position after liquidity operations.
 * The mapping key is the token id itself, so no local hashing (or WASM
 * peer) is involved.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The position token id, and optionally the program to read from.
 * @returns The decoded position, or `null` when none exists under that id.
 * @throws A transport error when the node is unreachable or rejects the
 *   request, and a decode error when the mapping value does not parse as a
 *   `Position`.
 *
 * @example
 * const position = await getPosition(client, { positionTokenId })
 * if (position) console.log(position.liquidity, position.tokens_owed0)
 */
export async function getPosition(client: Client, params: GetPositionParameters): Promise<GetPositionReturnType> {
  const raw = await readStructMapping(client, params.program, 'positions', params.positionTokenId, toPosition)
  if (!raw) return null
  return {
    ...raw,
    fee_growth_inside0_last_x_128: fromU256Parts(raw.fee_growth_inside0_last_x_128),
    fee_growth_inside1_last_x_128: fromU256Parts(raw.fee_growth_inside1_last_x_128),
  }
}
