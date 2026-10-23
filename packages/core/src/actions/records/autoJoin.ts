import { getRecordJoinPrograms } from '../../inventory/joinPrograms.js'
import type { Client } from '../../clients/createClient.js'
import type { InventoryResult, RecordAsset } from '../../inventory/types.js'
import { recordSettings, scopeOf } from '../../inventory/internal.js'
import { buildInventoryPlan } from '../../inventory/planner.js'
import { getRecordInventory } from './getRecordInventory.js'
import { rebalanceRecordInventory, type RebalanceRecordInventoryParameters } from './rebalanceRecordInventory.js'

/**
 * Configures automatic consolidation.
 * @property asset Token to consolidate.
 * @property minAmount Optional sufficient-record threshold in base units; omission consolidates all eligible records.
 * @property maxTransactions Operation ceiling, defaults to 100.
 */
export type AutoJoinParameters = Omit<RebalanceRecordInventoryParameters, 'plan'> & {
  asset: RecordAsset; minAmount?: bigint; maxTransactions?: number
}

/**
 * Consolidates records to one record or joins only enough to cover a requested amount.
 * Scans, signs and submits through the configured scanner and prover; existing sufficient records are preserved.
 * @param client Account client with recordManagement.enabled for coordinated execution.
 * @param params Asset, optional positive amount threshold and execution bounds.
 * @returns Confirmed progress or a resumable interruption.
 * @throws Before submission when available funds cannot cover the threshold.
 * @example
 * import { autoJoin, getRecordInventory, reconcileRecordInventory, type Client } from '@provablehq/veil-core'
 *
 * async function prepareOneCredit(client: Client) {
 *   // The client must explicitly enable recordManagement with a shared store.
 *   const asset = { program: 'credits.aleo' }
 *   const minAmount = 1_000_000n // Microcredits; omission consolidates all records.
 *   const result = await autoJoin(client, {
 *     asset, minAmount,
 *     maxTransactions: 8,
 *     timeoutMs: 120_000,
 *     pollIntervalMs: 2_000,
 *     maxFeeMicrocredits: 10_000_000n, // Total network-fee ceiling for this run.
 *   })
 *   console.log('Submitted transactions:', result.transactionIds)
 *   if (result.status === 'interrupted') {
 *     // An accepted step is not rolled back. Reconcile before deciding whether
 *     // a fresh scan and plan are safe; never blindly repeat an uncertain spend.
 *     await reconcileRecordInventory(client)
 *     throw new Error(result.reason ?? 'Consolidation interrupted')
 *   }
 *   // A sufficient existing record returns complete with zero steps.
 *   const inventory = await getRecordInventory(client, { asset })
 *   return inventory.available.find((record) => record.amount >= minAmount)
 * }
 */
export async function autoJoin(client: Client, params: AutoJoinParameters): Promise<InventoryResult> {
  const inventory = await getRecordInventory(client, { asset: params.asset })
  if (params.minAmount !== undefined && params.minAmount <= 0n) throw new Error('minAmount must be positive')
  let records = inventory.available
  if (params.minAmount !== undefined) {
    // Keep a sufficient existing record; otherwise select the largest records
    // until their total covers the requested spend, leaving the rest untouched.
    if (records.some((record) => record.amount >= params.minAmount!)) return { status: 'complete', transactionIds: [], completedSteps: 0 }
    records = [...records].sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.id.localeCompare(b.id))
    let sum = 0n
    records = records.filter((record) => { if (sum >= params.minAmount!) return false; sum += record.amount; return true })
    if (sum < params.minAmount) throw new Error('Insufficient available balance for autoJoin')
  }
  if (records.length <= 1) return { status: 'complete', transactionIds: [], completedSteps: 0 }
  // Use the same planner and sequential executor as a rebalance so consolidation
  // also waits for each dependent output and retains interrupted progress.
  const joinPrograms = records.length > 2 ? await getRecordJoinPrograms(client, inventory.asset) : []
  const plan = buildInventoryPlan({ scope: scopeOf(client), asset: inventory.asset, joinPrograms, tokenJoin: recordSettings(client).tokenJoin, target: { records: 1 },
    inputs: records.map(({ id, amount }) => ({ id, amount })), maxTransactions: params.maxTransactions })
  return rebalanceRecordInventory(client, { ...params, plan })
}
