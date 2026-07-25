import type { Client } from '@provablehq/veil-core'
import { toSlot } from '../../generated/shield_swap.js'
import { fromU256Parts } from '../../utils/q128.js'
import { readStructMapping } from './internal.js'

/**
 * Parameters for {@link getSlot}.
 *
 * @property poolKey Pool key as an Aleo field literal, including the `field`
 *   suffix. Same key space as `getPool`.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetSlotParameters = {
  poolKey: string
  program?: string
}

/**
 * A pool's live trading state, with the chain's `{ hi, lo }` u256 struct
 * fields joined to plain `bigint`s.
 *
 * @property tick The currently active tick (i32).
 * @property tick_spacing The pool's tick spacing (u32).
 * @property sqrt_price Current sqrt price, Q128.128 fixed-point (u256).
 * @property fee_protocol Protocol fee share setting (u8).
 * @property liquidity In-range liquidity (u128).
 * @property fee_growth_global0_x_128 Global token0 fee growth accumulator,
 *   Q128.128 (u256).
 * @property fee_growth_global1_x_128 Global token1 fee growth accumulator,
 *   Q128.128 (u256).
 * @property max_liquidity_per_tick Per-tick liquidity cap (u128).
 * @property protocol_fees0 Accrued protocol fees in token0 (u128, raw units).
 * @property protocol_fees1 Accrued protocol fees in token1 (u128, raw units).
 * @property next_init_below Nearest initialized tick at or below `tick` (i32).
 * @property next_init_above Nearest initialized tick above `tick` (i32).
 */
export interface Slot {
  tick: number
  tick_spacing: number
  sqrt_price: bigint
  fee_protocol: number
  liquidity: bigint
  fee_growth_global0_x_128: bigint
  fee_growth_global1_x_128: bigint
  max_liquidity_per_tick: bigint
  protocol_fees0: bigint
  protocol_fees1: bigint
  next_init_below: number
  next_init_above: number
}

/** The decoded live slot, or `null` when no pool exists under the key. */
export type GetSlotReturnType = Slot | null

/**
 * Reads a pool's live trading state from the on-chain `slots` mapping.
 *
 * The slot carries everything that moves as the pool trades: current
 * `sqrt_price` (Q128.128 fixed-point, `bigint`), active `tick`, in-range
 * `liquidity`, fee growth accumulators, and the `next_init_below`/
 * `next_init_above` tick neighbors used for insert hints. This — not the
 * static `pools` entry — is the source for building swap parameters and
 * slippage limits. The chain stores the u256 fields as `{ hi, lo }` u128
 * pairs; the decode joins them to `bigint`s.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool key to look up, and optionally the program to read from.
 * @returns The decoded slot, or `null` when no pool exists under that key.
 * @throws A transport error when the node is unreachable or rejects the
 *   request, and a decode error when the value does not parse as a `Slot` —
 *   both indicate an environment/deployment problem, not a missing pool.
 *
 * @example
 * const slot = await getSlot(client, { poolKey })
 * if (slot) console.log(slot.sqrt_price, slot.tick, slot.liquidity)
 */
export async function getSlot(client: Client, params: GetSlotParameters): Promise<GetSlotReturnType> {
  const raw = await readStructMapping(client, params.program, 'slots', params.poolKey, toSlot)
  if (!raw) return null
  return {
    ...raw,
    sqrt_price: fromU256Parts(raw.sqrt_price),
    fee_growth_global0_x_128: fromU256Parts(raw.fee_growth_global0_x_128),
    fee_growth_global1_x_128: fromU256Parts(raw.fee_growth_global1_x_128),
  }
}
