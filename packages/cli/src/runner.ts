import { getRecordInventory, planRecordInventory, rebalanceRecordInventory, reconcileRecordInventory,
  type Client, type InventoryResult, type RecordInventoryStore, type RecordSpend } from '@provablehq/veil-core'
import type { InventoryConfig } from './config.js'

/**
 * Reports one asset's bounded maintenance outcome.
 * @property program Asset program, or an asterisk for an account-wide wait.
 * @property status Completion, deferral or interruption category.
 * @property result Execution progress when a plan was executed.
 * @property reason Human-readable deferral or failure detail, when available.
 * @internal
 */
export type InventoryCycleResult = { program: string; status: string; result?: InventoryResult; reason?: string }

/**
 * Runs one maintenance pass after reconciling pending transactions.
 * Trading reservations take priority; cooldowns and count ranges suppress churn.
 * @param client Coordinated account client using the supplied store.
 * @param config Validated application limits and policies.
 * @param store Journal shared with participating trading clients.
 * @param scope Chain/account namespace, matching recordActions.
 * @param signal Optional shutdown signal, absent by default; stops subsequent work.
 * @returns Per-asset progress; never logs key material or record plaintext.
 * @throws When reconciliation or storage is unavailable; callers must retry before planning.
 * @example
 * const results = await runInventoryCycle(client, config, store, scope)
 */
export async function runInventoryCycle(client: Client, config: InventoryConfig, store: RecordInventoryStore, scope: string, signal?: AbortSignal): Promise<InventoryCycleResult[]> {
  const journal = await reconcileRecordInventory(client, { rebroadcast: true })
  const pending = journal.filter((entry) => entry.program !== '__inventory_manager__' && ['reserved', 'prepared', 'submitted'].includes(entry.status))
  if (pending.length) return [{ program: '*', status: 'waiting', reason: 'Unresolved transactions retain their reservations' }]
  const results: InventoryCycleResult[] = []
  let transactions = 0
  const feeCost = (entry: RecordSpend) => BigInt(entry.feeMicrocredits ?? '0') +
    (entry.program === 'credits.aleo' && entry.function === 'split' ? 10_000n : 0n)
  for (const policy of config.policies) {
    if (signal?.aborted) break
    const now = Date.now()
    const entries = await store.list(scope)
    const spent = entries.filter((entry) => entry.createdAt > now - 86_400_000 && entry.status !== 'cancelled').reduce((sum, entry) => sum + feeCost(entry), 0n)
    const latest = entries.filter((entry) => entry.program === policy.asset.program && entry.status !== 'cancelled').reduce((last, entry) => Math.max(last, entry.createdAt), 0)
    if (now - latest < config.cooldownMs) { results.push({ program: policy.asset.program, status: 'cooldown' }); continue }
    if (transactions >= config.maxTransactions || spent >= config.maxDailyFeeMicrocredits) {
      results.push({ program: policy.asset.program, status: 'budget', reason: 'Maintenance budget exhausted' }); continue
    }
    try {
      const inventory = await getRecordInventory(client, { asset: policy.asset })
      const [min, max] = policy.countRange ?? [policy.target.records, policy.target.records]
      if (policy.countRange && inventory.available.length >= min && inventory.available.length <= max &&
        inventory.available.every((record) => record.amount >= (policy.target.minRecordAmount ?? 1n))) {
        results.push({ program: policy.asset.program, status: 'satisfied' }); continue
      }
      const plan = await planRecordInventory(client, { ...policy, maxTransactions: config.maxTransactions - transactions })
      if (!plan.steps.length) { results.push({ program: policy.asset.program, status: 'satisfied' }); continue }
      const remaining = config.maxDailyFeeMicrocredits - spent - plan.deduction
      if (remaining < 0n) { results.push({ program: policy.asset.program, status: 'budget' }); continue }
      const budget = remaining < config.maxFeeMicrocredits ? remaining : config.maxFeeMicrocredits
      const result = await rebalanceRecordInventory(client, { plan, maxFeeMicrocredits: budget, signal })
      transactions += result.transactionIds.length
      results.push({ program: policy.asset.program, status: result.status, result })
      if (result.status === 'interrupted') break // Reconcile before any more writes.
    } catch (error) {
      results.push({ program: policy.asset.program, status: 'unavailable', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
