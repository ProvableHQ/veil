import type { Client } from '@provablehq/veil-core'
import { getSwapOutput } from '../reads/getSwapOutput.js'
import { isBlindedAddressUsed } from '../reads/isBlindedAddressUsed.js'
import {
  withStoreLock,
  type BlindedIdentityRecord,
  type BlindedIdentityStore,
} from '../../utils/blinding/store.js'

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
