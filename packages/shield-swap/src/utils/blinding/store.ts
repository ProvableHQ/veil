import type { BlindedIdentity } from './identity.js'

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
 * @property status Lifecycle position — see {@link BlindedIdentityStatus}.
 */
export interface BlindedIdentityRecord extends BlindedIdentity {
  swapId?: string
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

/**
 * Attaches a swap id to a reserved blinded identity.
 *
 * The swap id is only known once the swap is built, and without it a consumed
 * identity cannot be told apart from a claimed one — so
 * {@link syncBlindedIdentities} reports every unlabelled consumed identity as
 * `swapped`. Call this with the handle a swap returns.
 *
 * Writes to the store. Does not hit the network. A `blindedAddress` the store
 * does not hold is ignored rather than an error, so replaying a claim is safe.
 *
 * @param store The store holding the reservation.
 * @param params Blinded address to label and the swap id to attach.
 *
 * @example
 * const handle = await client.swap({ poolKey, tokenInId, amountIn, blindedIdentity: identity })
 * await client.recordBlindedSwap({ blindedAddress: identity.blindedAddress, swapId: handle.swapId! })
 */
export async function recordBlindedSwap(
  store: BlindedIdentityStore,
  params: { blindedAddress: string; swapId: string },
): Promise<void> {
  await withStoreLock(store, async () => {
    const records = await store.load()
    await store.save(
      records.map((r) => (r.blindedAddress === params.blindedAddress ? { ...r, swapId: params.swapId } : r)),
    )
  })
}
