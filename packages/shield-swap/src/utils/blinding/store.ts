import type { BlindedIdentity } from './identity.js'
import type { PersistedHandle } from './handles.js'

/**
 * Lifecycle of a reserved blinded identity.
 *
 * `reserved` — derived and handed to a caller, not yet observed in the
 * program's `used_blinded_addresses` mapping. A reserved counter is never
 * handed out twice, which is what keeps concurrent swaps off each other.
 *
 * `swapped` — the blinded address is on chain and its swap output is still in
 * `swap_outputs`, so the proceeds are waiting to be claimed.
 *
 * `claimed` — the blinded address is on chain but its swap output is gone,
 * meaning the output was claimed. Terminal.
 */
export type BlindedIdentityStatus = 'reserved' | 'swapped' | 'claimed'

/**
 * A blinded identity plus what is known about its on-chain fate.
 *
 * @property counter The derivation counter, unique per account and program.
 * @property blindingFactor The scalar literal the swap is bound to.
 * @property blindedAddress The derived `aleo1…` address the pool pays.
 * @property swapId The swap this identity was spent on, once known. Absent
 *   until {@link recordBlindedSwap} attaches it, and required to tell
 *   `swapped` from `claimed`.
 * @property handle The swap's handle in storable form, when one was recorded.
 *   A claim consumes a whole handle rather than a swap id, so this is what makes
 *   an unclaimed swap claimable from the store instead of only from the process
 *   that made it.
 * @property status Lifecycle position — see {@link BlindedIdentityStatus}.
 */
export interface BlindedIdentityRecord extends BlindedIdentity {
  swapId?: string
  handle?: PersistedHandle
  status: BlindedIdentityStatus
}

/**
 * Persistence for reserved blinded identities.
 *
 * Deliberately whole-list rather than per-record: reservation reads every
 * known counter to pick the next one, so a store that cannot enumerate is
 * useless for it. Implementations need not be concurrency-safe across
 * processes — {@link reserveBlindedIdentity} serializes callers within one
 * process and re-checks the chain, but two processes sharing an account can
 * still collide.
 *
 * @property load Returns every known record, in any order.
 * @property save Replaces the stored set with `records`.
 */
export interface BlindedIdentityStore {
  load: () => Promise<BlindedIdentityRecord[]>
  save: (records: BlindedIdentityRecord[]) => Promise<void>
}

/**
 * Builds a blinded-identity store held in memory.
 *
 * Reservations survive for the life of the process, so concurrent swaps from
 * one client do not collide — but nothing survives a restart, and the next run
 * re-derives its starting counter by scanning the chain. Suited to short-lived
 * scripts; a durable store (`fileBlindedIdentityStore` on
 * `@provablehq/shield-swap-sdk/node`) avoids the rescan.
 *
 * @param initial Records to seed the store with. Defaults to empty.
 * @returns A store backed by an array. Pure and local.
 *
 * @example
 * const store = memoryBlindedIdentityStore()
 * const client = walletClient.extend(shieldSwapActions({ blindedIdentities: store }))
 */
export function memoryBlindedIdentityStore(initial: BlindedIdentityRecord[] = []): BlindedIdentityStore {
  let records = [...initial]
  return {
    load: async () => [...records],
    save: async (next) => {
      records = [...next]
    },
  }
}

/**
 * Serializes the read-modify-write around each store.
 *
 * Reservation picks the next counter from what the store already holds, so two
 * concurrent calls that both load before either saves derive the same counter
 * and the second swap reverts on finalize. Keyed on the store instance, so
 * clients sharing a store share the queue.
 */
const queues = new WeakMap<BlindedIdentityStore, Promise<unknown>>()

export function withStoreLock<T>(store: BlindedIdentityStore, fn: () => Promise<T>): Promise<T> {
  // Chain onto the prior holder's settlement, not its value, so one caller's
  // failure does not strand the queue.
  const next = (queues.get(store) ?? Promise.resolve()).then(fn, fn)
  queues.set(
    store,
    next.catch(() => {}),
  )
  return next
}
