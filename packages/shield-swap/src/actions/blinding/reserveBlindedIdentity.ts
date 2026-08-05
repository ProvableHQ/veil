import type { Client } from '@provablehq/veil-core'
import { isBlindedAddressUsed } from '../reads/isBlindedAddressUsed.js'
import { requireAccount } from '../../utils/guards.js'
import { deriveBlindedAddress, deriveBlindingFactor, viewKeyToScalar } from '../../utils/blinding/identity.js'
import {
  withStoreLock,
  type BlindedIdentityRecord,
  type BlindedIdentityStore,
} from '../../utils/blinding/store.js'

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
