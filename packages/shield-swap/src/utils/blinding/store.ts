import type { Client } from '@provablehq/veil-core'
import { getSwapOutput } from '../../actions/reads/getSwapOutput.js'
import { isBlindedAddressUsed } from '../../actions/reads/isBlindedAddressUsed.js'
import { requireAccount } from '../guards.js'
import {
  deriveBlindedAddress,
  deriveBlindingFactor,
  viewKeyToScalar,
  type BlindedIdentity,
} from './identity.js'

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

function withStoreLock<T>(store: BlindedIdentityStore, fn: () => Promise<T>): Promise<T> {
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
 * Parameters for {@link reserveBlindedIdentity}.
 *
 * @property store Where reservations are recorded.
 * @property program shield_swap program to derive and scan against. Defaults
 *   to `DEFAULT_PROGRAM` inside the derivation.
 * @property maxScan Counters to try before giving up. Defaults to 64.
 */
export type ReserveBlindedIdentityParameters = {
  store: BlindedIdentityStore
  program?: string
  maxScan?: number
}

/**
 * Reserves the next unused blinded identity for the client's account.
 *
 * Blinded addresses must be unique — the program asserts the address is absent
 * from `used_blinded_addresses` and reverts on finalize otherwise. Deriving on
 * demand from a chain read alone is unsafe under concurrency: two swaps read
 * the same "unused" counter and the second reverts. This closes that window by
 * recording each reservation before returning it and never handing out a
 * counter at or below one already stored.
 *
 * Cold start (an empty store) scans upward from counter 0 for the first
 * address the chain does not know, so a lost store costs reads rather than
 * correctness. With records present it moves monotonically from the highest
 * known counter, and still skips any address the chain already carries — which
 * is what recovers from a store that another process has moved past.
 *
 * Requires a local account. A wallet derives and tracks its own blinded
 * identities, and reserving on its behalf would desynchronize both sides.
 *
 * Hits the network (one mapping read per candidate counter) and writes to the
 * store.
 *
 * @param client A wallet client with a local account.
 * @param params Store, program override, and scan bound.
 * @returns The reserved record, status `reserved`.
 * @throws When the account is missing or not local, or when `maxScan`
 *   consecutive counters are all already used on chain.
 *
 * @example
 * const identity = await client.reserveBlindedIdentity()
 * const handle = await client.swap({ poolKey, tokenInId, amountIn, blindedIdentity: identity })
 * await client.recordBlindedSwap({ blindedAddress: identity.blindedAddress, swapId: handle.swapId! })
 */
export async function reserveBlindedIdentity(
  client: Client,
  params: ReserveBlindedIdentityParameters,
): Promise<BlindedIdentityRecord> {
  const account = requireAccount(client, 'reserveBlindedIdentity')
  if (account.type !== 'local' || !account.viewKey) {
    throw new Error(
      'reserveBlindedIdentity requires a local account — a connected wallet derives and tracks its own ' +
        'blinded identities. Omit `blindedIdentity` and let the wallet supply one.',
    )
  }
  const viewKeyScalar = await viewKeyToScalar(account.viewKey)
  const maxScan = params.maxScan ?? 64

  return withStoreLock(params.store, async () => {
    const records = await params.store.load()
    // Monotonic from the highest known counter, so a still-unconfirmed
    // (`reserved`) identity is never handed out a second time. An empty store
    // starts at 0 and lets the chain reads find the frontier.
    const start = records.length ? Math.max(...records.map((r) => r.counter)) + 1 : 0

    for (let counter = start; counter < start + maxScan; counter++) {
      const blindingFactor = await deriveBlindingFactor(viewKeyScalar, counter, params.program)
      const blindedAddress = await deriveBlindedAddress(blindingFactor, account.address, params.program)
      if (await isBlindedAddressUsed(client, { address: blindedAddress, program: params.program })) continue

      const record: BlindedIdentityRecord = { counter, blindingFactor, blindedAddress, status: 'reserved' }
      await params.store.save([...records, record])
      return record
    }

    throw new Error(
      `No unused blinded address in counters ${start}…${start + maxScan - 1} for ${account.address}. ` +
        'Pass a higher maxScan, or check that the store and the program match the account.',
    )
  })
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

/**
 * Parameters for {@link syncBlindedIdentities}.
 *
 * @property store The store to reconcile.
 * @property program shield_swap program to read. Defaults to
 *   `DEFAULT_PROGRAM` inside the reads.
 */
export type SyncBlindedIdentitiesParameters = {
  store: BlindedIdentityStore
  program?: string
}

/**
 * Reconciles stored reservations against the chain and promotes their statuses.
 *
 * A reservation is recorded before its swap is submitted, so the store leads
 * the chain. This settles the difference: an identity absent from
 * `used_blinded_addresses` stays `reserved` (its swap is unconfirmed, or was
 * never submitted); one present with its swap output still in `swap_outputs`
 * becomes `swapped`; one present whose output is gone becomes `claimed`.
 *
 * An identity with no `swapId` cannot be distinguished once consumed and is
 * reported `swapped` — see {@link recordBlindedSwap}. Already-`claimed`
 * records are terminal and are not re-read.
 *
 * Hits the network (up to two mapping reads per unsettled record) and writes
 * the reconciled set back to the store.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Store and program override.
 * @returns The reconciled records.
 *
 * @example
 * const settled = await client.syncBlindedIdentities()
 * const claimable = settled.filter((r) => r.status === 'swapped')
 */
export async function syncBlindedIdentities(
  client: Client,
  params: SyncBlindedIdentitiesParameters,
): Promise<BlindedIdentityRecord[]> {
  return withStoreLock(params.store, async () => {
    const records = await params.store.load()
    const reconciled: BlindedIdentityRecord[] = []

    for (const record of records) {
      if (record.status === 'claimed') {
        reconciled.push(record)
        continue
      }
      const used = await isBlindedAddressUsed(client, {
        address: record.blindedAddress,
        program: params.program,
      })
      if (!used) {
        reconciled.push({ ...record, status: 'reserved' })
        continue
      }
      // Consumed on chain. The swap output still being present means the
      // proceeds are unclaimed; its absence means they were collected.
      const output = record.swapId
        ? await getSwapOutput(client, { swapId: record.swapId, program: params.program })
        : null
      reconciled.push({ ...record, status: record.swapId && output === null ? 'claimed' : 'swapped' })
    }

    await params.store.save(reconciled)
    return reconciled
  })
}
