import { getRecordJoinPrograms } from '../../inventory/joinPrograms.js'
import type { Client } from '../../clients/createClient.js'
import type { InventoryPlan, InventoryTarget, RecordAsset } from '../../inventory/types.js'
import { recordSettings, scopeOf } from '../../inventory/internal.js'
import { buildInventoryPlan } from '../../inventory/planner.js'
import { getRecordInventory } from './getRecordInventory.js'

/**
 * Defines a read-only inventory planning request.
 * @property asset Program with optional record-name and amount-field overrides.
 * @property target Desired record count, minimum amount and distribution.
 * @property maxTransactions Operation ceiling, defaults to 100, at most 10000.
 */
export type PlanRecordInventoryParameters = { asset: RecordAsset; target: InventoryTarget; maxTransactions?: number }

/**
 * Plans joins and splits against the current eligible record inventory.
 * Reads the scanner and deployed interface; never signs or submits.
 * @param client Account client used to scan and scope the plan.
 * @param params Asset, target and transaction limit.
 * @returns Plaintext-free dependency plan with intrinsic credits deductions.
 * @throws When the target is impossible or exceeds the transaction limit.
 * @example
 * import { planRecordInventory, type Client } from '@provablehq/veil-core'
 *
 * async function previewSixCreditsRecords(client: Client) {
 *   const plan = await planRecordInventory(client, {
 *     asset: { program: 'credits.aleo' },
 *     target: {
 *       records: 6,
 *       minRecordAmount: 1_000_000n, // Each record must hold at least one credit.
 *       distribution: 'balanced',
 *       toleranceBps: 0,
 *     },
 *     maxTransactions: 24,
 *   })
 *   // Planning reads the current inventory but neither reserves nor spends it.
 *   // Credits split deductions reduce the balance; network fees are separate.
 *   console.log('Intrinsic deduction in microcredits:', plan.deduction.toString())
 *   console.table(plan.steps.map((step) => ({
 *     operation: step.kind,
 *     inputs: step.inputs.length,
 *     outputs: step.outputs.length,
 *     helper: step.joinProgram?.program ?? 'native',
 *   })))
 *   // Pass this unchanged plan to rebalanceRecordInventory after review.
 *   return plan
 * }
 */
export async function planRecordInventory(client: Client, params: PlanRecordInventoryParameters): Promise<InventoryPlan> {
  const inventory = await getRecordInventory(client, { asset: params.asset })
  const joinPrograms = inventory.available.length > 2 ? await getRecordJoinPrograms(client, inventory.asset) : []
  // Retain only nonces and amounts in the plan; record plaintext stays in the
  // scanner result and is fetched again when each step is executed.
  return buildInventoryPlan({ ...params, asset: inventory.asset, joinPrograms, tokenJoin: recordSettings(client).tokenJoin,
    scope: scopeOf(client), inputs: inventory.available.map(({ id, amount }) => ({ id, amount })) })
}
