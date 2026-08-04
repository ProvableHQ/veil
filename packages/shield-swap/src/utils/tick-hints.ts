import type { Client } from '@provablehq/veil-core'
import { getTick } from '../actions/reads/getTick.js'
import { getSlot } from '../actions/reads/getSlot.js'
import { tryLoadSdk } from './sdk.js'
import { MIN_TICK_SENTINEL } from './q128.js'

/** Bound on the tick-list walk, so a malformed list cannot loop forever. */
const MAX_HINT_HOPS = 1024

/**
 * Picks a hint from the slot's initialized-tick neighbours alone.
 *
 * The fallback for callers without the WASM peer, and what this module returned
 * before the tick-list walk. Needs one mapping read keyed by the pool, so it
 * derives nothing. Correct only when no initialized tick sits between the
 * neighbour it returns and the target — the contract rejects a hint above its
 * target on finalize.
 */
async function slotNeighborHint(client: Client, params: PickInsertHintParameters): Promise<number> {
  const slot = await getSlot(client, { poolKey: params.poolKey, program: params.program })
  if (!slot) return MIN_TICK_SENTINEL
  if (params.targetTick > slot.tick && slot.next_init_above < params.targetTick) {
    return slot.next_init_above
  }
  return slot.next_init_below
}

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
 * predecessor. This walks that list from the {@link MIN_TICK_SENTINEL} anchor
 * until the next entry reaches or passes the target, so the entry it stops on is
 * the predecessor the contract requires. The slot's active-range neighbours
 * (`next_init_below`/`next_init_above`) are deliberately not used: they bracket
 * the pool's *current* tick, which is above the target whenever the target sits
 * further out, and the contract rejects that on finalize.
 *
 * Returns the true predecessor, so the hint is accepted for any target rather
 * than only for one near the active range. Hits the network once per
 * initialized tick below the target — a handful of reads on live pools, since
 * the list holds one entry per initialized tick, not per tick in range.
 *
 * The `ticks` mapping is keyed by a hash of pool and tick, so the walk needs the
 * optional `@provablehq/sdk` peer to derive each key. Without it this falls back
 * to the slot's neighbours — best-effort, correct only for a target within one
 * initialized tick of the current price — rather than failing, so a wallet-backed
 * install that has no WASM keeps the behaviour it had before the walk existed. A
 * caller in that position who needs a distant range should pass `tickLowerHint`
 * and `tickUpperHint` explicitly.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Pool and the target tick.
 * @returns The greatest initialized tick below `targetTick`, or
 *   {@link MIN_TICK_SENTINEL} when nothing is initialized below it. Without the
 *   WASM peer, the slot's nearest neighbour below the target instead.
 * @throws When the list holds no entry below the target within the hop bound,
 *   which means the pool's tick list is malformed rather than merely deep.
 *
 * @example
 * const poolKey = '…field'
 * const hint = await pickInsertHint(client, { poolKey, targetTick: -62400 })
 * await client.mint({ poolKey, tickLower: -62400, tickUpper: -61200, tickLowerHint: hint, ... })
 */
export async function pickInsertHint(client: Client, params: PickInsertHintParameters): Promise<number> {
  // Deriving a tick key hashes with BHP256, which lives in the WASM peer. Read
  // paths and wallet-backed writes are meant never to require it — `mint` uses
  // the soft loader and `increaseLiquidity` touches it not at all — so an absent
  // peer degrades to the slot's neighbours rather than throwing and taking those
  // callers' mints with it.
  if (!(await tryLoadSdk())) return slotNeighborHint(client, params)

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
