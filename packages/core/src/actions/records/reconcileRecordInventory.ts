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
 * Failed rebroadcasts are recorded per entry so later transactions can still be reconciled.
 * @param client Client with recordManagement.enabled and the original durable store.
 * @param params Optional exact-transaction rebroadcast, disabled by default.
 * @returns Current scoped journal with rebroadcast attempt counts and any lastRebroadcastError.
 *   Reads the chain and optionally resubmits transactions; failed rebroadcasts retain their inputs.
 * @throws On storage errors or confirmation lookup errors other than transaction-not-found (HTTP 404).
 * @example
 * import type { WalletClient } from '@provablehq/veil-core'
 *
 * async function inspectRecovery(client: WalletClient) {
 *   // Reopen the original store and enable recordManagement on the same account
 *   // and chain. The default only reads confirmations; it never rebroadcasts.
 *   const journal = await client.reconcileRecordInventory()
 *   const unresolved = journal.filter((entry) =>
 *     entry.status !== 'confirmed' && entry.status !== 'rejected' && entry.status !== 'cancelled',
 *   )
 *   console.table(unresolved.map((entry) => ({
 *     operation: entry.id, transactionId: entry.transactionId, status: entry.status,
 *     attempts: entry.rebroadcastAttempts ?? 0, error: entry.lastRebroadcastError,
 *   })))
 *   return unresolved // Missing transactions remain reserved.
 * }
 *
 * async function rebroadcastSavedTransactions(client: WalletClient) {
 *   // Choose this explicitly after inspection. Only saved, proved transactions
 *   // are rebroadcast, with their original proof and id; nothing is rebuilt.
 *   await client.reconcileRecordInventory({ rebroadcast: true })
 *   // Broadcast acceptance is not confirmation. Inspect again on a later poll.
 *   return inspectRecovery(client)
 * }
 */
export async function reconcileRecordInventory(client: Client, params: ReconcileRecordInventoryParameters = {}): Promise<RecordSpend[]> {
  const config = management(client)
  if (!config) throw new Error('Reconciliation requires recordManagement.enabled with a shared store')
  const scope = scopeOf(client)
  for (const entry of await config.store.list(scope)) {
    if (entry.status === 'confirmed' || entry.status === 'rejected' || entry.status === 'cancelled') continue
    if (!entry.transactionId) continue // An uncertain wallet response needs external reconciliation.
    let missing = false
    let result: Awaited<ReturnType<typeof getConfirmedTransaction>> | undefined
    try {
      // Only a definitive chain result changes the reservation state. A 404
      // does not prove that a prepared or submitted transaction was rejected.
      result = await getConfirmedTransaction(client, { id: entry.transactionId })
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
      missing = true
    }
    if (!missing) {
      // Keep checkpoint writes outside the lookup catch so a storage 404 cannot
      // be mistaken for a missing transaction and trigger another broadcast.
      if (result?.status === 'accepted' || result?.status === 'rejected') {
        await config.store.update(scope, entry.id, { status: result.status === 'accepted' ? 'confirmed' : 'rejected',
          transaction: undefined, lastRebroadcastError: undefined })
        continue
      }
      throw new Error('Unexpected transaction confirmation response')
    }
    // Recovery reuses the saved proof and id; rebuilding could create a second
    // transaction while the original submission is still unresolved.
    if (missing && params.rebroadcast && entry.transaction) {
      const rebroadcastAttempts = (entry.rebroadcastAttempts ?? 0) + 1
      try {
        const id = await client.request({ method: 'sendTransaction', params: { transaction: JSON.stringify(entry.transaction) } })
        if (id !== entry.transactionId) throw new Error('Rebroadcast returned a different transaction id')
      } catch (error) {
        // A broadcast failure is not a chain rejection. Keep the saved proof and
        // all inputs, but let later entries reach their own confirmation checks.
        await config.store.update(scope, entry.id, { rebroadcastAttempts,
          lastRebroadcastError: error instanceof Error ? error.message : String(error) })
        continue
      }
      // Persist outside the broadcast catch: storage failures must still abort.
      await config.store.update(scope, entry.id, { status: 'submitted', rebroadcastAttempts, lastRebroadcastError: undefined })
    }
  }
  return config.store.list(scope)
}
