import type { Client } from '@veil/core'
import { toSlot, type Slot } from '../../generated/shield_swap.js'
import { readStructMapping } from './internal.js'

/**
 * Parameters for {@link getSlot}.
 *
 * @property poolKey Pool key as an Aleo field literal, including the `field`
 *   suffix. Same key space as `getPool`.
 * @property program Program to read from. Defaults to the generated
 *   shield_swap `PROGRAM_ID`.
 */
export type GetSlotParameters = {
  poolKey: string
  program?: string
}

export type GetSlotReturnType = Slot | null

/**
 * Reads a pool's live trading state from the on-chain `slots` mapping.
 *
 * The slot carries everything that moves as the pool trades: current
 * `sqrt_price` (Q64 fixed-point, `bigint`), active `tick`, in-range
 * `liquidity`, fee growth accumulators, and the `next_init_below`/
 * `next_init_above` tick neighbors used for insert hints. This — not the
 * static `pools` entry — is the source for building swap parameters and
 * slippage limits.
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
  return readStructMapping(client, params.program, 'slots', params.poolKey, toSlot)
}
