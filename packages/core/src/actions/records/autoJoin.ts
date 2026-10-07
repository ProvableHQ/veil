import type { Client } from '../../clients/createClient.js'
import type { InventoryResult, RecordAsset } from '../../inventory/types.js'
import { management, scopeOf } from '../../inventory/internal.js'
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
 * @param client Client extended with recordActions.
 * @param params Asset, optional positive amount threshold and execution bounds.
 * @returns Confirmed progress or a resumable interruption.
 * @throws Before submission when available funds cannot cover the threshold.
 * @example
 * const result = await autoJoin(client, { asset, minAmount: 1_000_000n })
 */
export async function autoJoin(client: Client, params: AutoJoinParameters): Promise<InventoryResult> {
  const inventory = await getRecordInventory(client, { asset: params.asset })
  if (params.minAmount !== undefined && params.minAmount <= 0n) throw new Error('minAmount must be positive')
  let records = inventory.available
  if (params.minAmount !== undefined) {
    if (records.some((record) => record.amount >= params.minAmount!)) return { status: 'complete', transactionIds: [], completedSteps: 0 }
    records = [...records].sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.id.localeCompare(b.id))
    let sum = 0n
    records = records.filter((record) => { if (sum >= params.minAmount!) return false; sum += record.amount; return true })
    if (sum < params.minAmount) throw new Error('Insufficient available balance for autoJoin')
  }
  if (records.length <= 1) return { status: 'complete', transactionIds: [], completedSteps: 0 }
  const plan = buildInventoryPlan({ scope: scopeOf(client), asset: params.asset, tokenJoin: management(client)?.tokenJoin, target: { records: 1 },
    inputs: records.map(({ id, amount }) => ({ id, amount })), maxTransactions: params.maxTransactions })
  return rebalanceRecordInventory(client, { ...params, plan })
}
