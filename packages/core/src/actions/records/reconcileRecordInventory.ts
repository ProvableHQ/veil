import type { Client } from '../../clients/createClient.js'
import type { RecordSpend } from '../../inventory/types.js'
import { management, scopeOf } from '../../inventory/internal.js'
import { getConfirmedTransaction } from '../public/getConfirmedTransaction.js'

/**
 * Configures pending transaction recovery.
 * @property rebroadcast Allows resubmission of the exact proved transaction; defaults to false.
 */
export type ReconcileRecordInventoryParameters = { rebroadcast?: boolean }

/**
 * Reconciles journal entries against chain acceptance after an interruption.
 * Missing transactions remain reserved; optional rebroadcast reuses the same proof/id.
 * @param client Client extended with recordActions and the original durable store.
 * @param params Optional exact-transaction rebroadcast, disabled by default.
 * @returns Current scoped journal. Reads the chain and optionally resubmits transactions.
 * @throws On storage/network errors other than transaction-not-found (HTTP 404).
 * @example
 * const journal = await reconcileRecordInventory(client, { rebroadcast: true })
 */
export async function reconcileRecordInventory(client: Client, params: ReconcileRecordInventoryParameters = {}): Promise<RecordSpend[]> {
  const config = management(client)
  if (!config) throw new Error('Reconciliation requires recordActions with a shared store')
  const scope = scopeOf(client)
  for (const entry of await config.store.list(scope)) {
    if (entry.status === 'confirmed' || entry.status === 'rejected' || entry.status === 'cancelled') continue
    if (!entry.transactionId) continue // An uncertain wallet response needs external reconciliation.
    let missing = false
    try {
      const result = await getConfirmedTransaction(client, { id: entry.transactionId })
      if (result.status === 'accepted' || result.status === 'rejected') {
        await config.store.update(scope, entry.id, { status: result.status === 'accepted' ? 'confirmed' : 'rejected', transaction: undefined })
        continue
      }
      throw new Error('Unexpected transaction confirmation response')
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
      missing = true
    }
    if (missing && params.rebroadcast && entry.transaction) {
      const id = await client.request({ method: 'sendTransaction', params: { transaction: JSON.stringify(entry.transaction) } })
      if (id !== entry.transactionId) throw new Error('Rebroadcast returned a different transaction id')
      await config.store.update(scope, entry.id, { status: 'submitted' })
    }
  }
  return config.store.list(scope)
}
