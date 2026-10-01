import { rebalanceRecordInventory, type Client, type InventoryResult, type RebalanceRecordInventoryParameters } from '@provablehq/veil-core'
import { planInventory, type PlanInventoryParameters } from './planInventory.js'

/** Combines DEX token resolution with core inventory execution limits. */
export type RebalanceInventoryParameters = PlanInventoryParameters & Omit<RebalanceRecordInventoryParameters, 'plan'>

/**
 * Rebalances a DEX token's underlying private inventory through core join/split actions.
 * Scans, plans, signs and waits for each dependent transition using shared reservations.
 * @param client Account client extended with recordActions before shieldSwapActions.
 * @param params Token, target, API, and bounded execution options.
 * @returns Completed progress or a resumable interruption.
 * @throws On unsupported assets or invalid targets before submission.
 * @example
 * const result = await rebalanceInventory(client, { token: 'ALEO', target: { records: 4 }, api })
 */
export async function rebalanceInventory(client: Client, params: RebalanceInventoryParameters): Promise<InventoryResult> {
  const plan = await planInventory(client, params)
  return rebalanceRecordInventory(client, { ...params, plan })
}
