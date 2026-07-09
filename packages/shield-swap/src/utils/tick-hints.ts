import type { Client } from '@provablehq/veil-core'
import { getSlot } from '../actions/reads/getSlot.js'
import { MIN_TICK } from './tick-math.js'

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
 * Known limitation (inherited from the Provable reference client): when
 * multiple initialized ticks lie between the slot's neighbors and the
 * target, the true predecessor cannot be found without hashing tick keys
 * (BHP256 struct parity the SDK does not provide). The hint returned is
 * best-effort; a wrong hint makes the transaction revert on the contract's
 * assert — pick bounds closer to the active range or pass explicit hints.
 *
 * Hits the network: one slot read.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Pool and the target tick.
 * @returns The hint tick — the presumed predecessor of `targetTick`, or the
 *   MIN_TICK list anchor for an empty/unknown neighborhood.
 *
 * @example
 * const hint = await pickInsertHint(client, { poolKey, targetTick: -62400 })
 */
export async function pickInsertHint(client: Client, params: PickInsertHintParameters): Promise<number> {
  const slot = await getSlot(client, { poolKey: params.poolKey, program: params.program })
  if (!slot) return MIN_TICK

  // The chain's Slot always carries both neighbors (the tick list is anchored
  // at the MIN/MAX sentinels), so the values are used verbatim.
  if (params.targetTick > slot.tick) {
    if (slot.next_init_above < params.targetTick) return slot.next_init_above
    return slot.next_init_below
  }
  return slot.next_init_below
}
