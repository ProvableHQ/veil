import type { Client } from '@provablehq/veil-core'
import { getTick } from '../actions/reads/getTick.js'
import { getSlot } from '../actions/reads/getSlot.js'
import { tryLoadSdk } from './sdk.js'
import { MIN_TICK_SENTINEL } from './q128.js'

/** Bound on the tick-list walk, so a malformed list cannot loop forever. */
const MAX_HINT_HOPS = 1024

/**
 * Resolves the tick list, whether supplied as an array or a supplier.
 *
 * A supplier that fails resolves to `undefined` rather than rejecting, so an
 * unreachable or unauthenticated API drops to the slot-neighbour guess instead
 * of failing a mint outright.
 */
async function resolveTicks(
  source: PickInsertHintParameters['initializedTicks'],
): Promise<number[] | undefined> {
  if (!source) return undefined
  if (Array.isArray(source)) return source
  return source().catch(() => undefined)
}

/**
 * The greatest tick in `ticks` below `target`, or the sentinel when none is.
 *
 * Sorts defensively: the contract's assert compares against the immediate
 * predecessor, so a list arriving out of order would otherwise yield a hint with
 * an initialized tick between it and the target, which finalize rejects.
 */
function predecessorOf(ticks: number[], target: number): number {
  const below = ticks.filter((tick) => tick < target).sort((a, b) => a - b)
  return below.length ? below[below.length - 1]! : MIN_TICK_SENTINEL
}

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
 * @property initializedTicks The pool's initialized ticks, ascending, or a
 *   supplier for them — `client.api.getInitializedTicks` is one. Used only when
 *   the WASM peer is unavailable, in place of walking the on-chain list; the
 *   decorator supplies it from the configured API automatically.
 */
export type PickInsertHintParameters = {
  poolKey: string
  targetTick: number
  program?: string
  initializedTicks?: number[] | (() => Promise<number[]>)
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
 * optional `@provablehq/sdk` peer to derive each key. Three sources, in
 * descending order of authority:
 *
 * 1. The contract's own list, walked here — used whenever the peer is present.
 * 2. `initializedTicks`, which the decorator fills from the DEX API's
 *    `/pools/{key}/initialized-ticks`. Exact for any target and needs no
 *    derivation, but it is indexed from positions rather than read from the
 *    contract, so it can lag a position minted moments ago.
 * 3. The slot's neighbours — one read, no derivation, and correct only for a
 *    target within one initialized tick of the current price. The last resort,
 *    and what this returned before the walk existed.
 *
 * Degrading rather than throwing matters because `mint` and `increaseLiquidity`
 * both call this: `mint` loads the peer softly and `increaseLiquidity` not at
 * all, so requiring it here would break wallet-backed installs that mint today.
 * A caller on tier 3 who needs a distant range should pass `tickLowerHint` and
 * `tickUpperHint` explicitly.
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
  // peer must not throw and take those callers' mints with it. A supplied tick
  // list answers the question exactly, with no derivation; failing that, the
  // slot's neighbours are the best guess available.
  if (!(await tryLoadSdk())) {
    const ticks = await resolveTicks(params.initializedTicks)
    return ticks ? predecessorOf(ticks, params.targetTick) : slotNeighborHint(client, params)
  }

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
