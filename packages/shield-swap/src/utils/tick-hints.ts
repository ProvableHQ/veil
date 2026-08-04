import type { Client } from '@provablehq/veil-core'
import { getTick } from '../actions/reads/getTick.js'
import { MIN_TICK_SENTINEL } from './q128.js'

/** Bound on the tick-list walk, so a malformed list cannot loop forever. */
const MAX_HINT_HOPS = 1024

/**
 * Parameters for {@link pickInsertHint}.
 *
 * @property poolKey Pool key field literal.
 * @property targetTick The tick being initialized or updated (a position
 *   bound, spacing-aligned).
 * @property program shield_swap program override. Defaults inside `getSlot`.
 */
export type PickInsertHintParameters = {
  poolKey: string
  targetTick: number
  program?: string
}

/**
 * Picks the insert hint for a position tick.
 *
 * The contract keeps initialized ticks in a sorted linked list and asserts
 * `hint.tick < target && hint.next > target` — the hint must be the target's
 * predecessor. This derives the hint from the slot's active-range neighbors
 * (`next_init_below`/`next_init_above`), which covers pools with few
 * initialized ticks around the current price.
 *
 * Returns the true predecessor, so the hint is accepted for any target rather
 * than only for one near the active range. Hits the network once per
 * initialized tick below the target — a handful of reads on live pools, since
 * the list holds one entry per initialized tick, not per tick in range.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Pool and the target tick.
 * @returns The greatest initialized tick below `targetTick`, or
 *   {@link MIN_TICK_SENTINEL} when nothing is initialized below it.
 * @throws When the list holds no entry below the target within the hop bound,
 *   which means the pool's tick list is malformed rather than merely deep.
 *
 * @example
 * const poolKey = '…field'
 * const hint = await pickInsertHint(client, { poolKey, targetTick: -62400 })
 * await client.mint({ poolKey, tickLower: -62400, tickUpper: -61200, tickLowerHint: hint, ... })
 */
export async function pickInsertHint(client: Client, params: PickInsertHintParameters): Promise<number> {
  // Walk the initialized-tick list from the MIN sentinel to the last entry
  // below the target. The slot's own neighbours only bracket the *current*
  // tick, so using them returns a tick above the target whenever the target
  // sits further out than one entry — which the contract rejects on finalize.
  let cursor = MIN_TICK_SENTINEL
  for (let hops = 0; hops < MAX_HINT_HOPS; hops++) {
    const tick = await getTick(client, { poolKey: params.poolKey, tick: cursor, program: params.program })
    const next = tick?.next
    if (next === undefined || next >= params.targetTick) return cursor
    cursor = next
  }
  throw new Error(
    `Could not find an insert hint for tick ${params.targetTick} within ${MAX_HINT_HOPS} initialized ticks of pool ${params.poolKey}.`,
  )
}
