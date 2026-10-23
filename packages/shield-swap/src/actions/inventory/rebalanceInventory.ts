import { rebalanceRecordInventory, type Client, type InventoryResult, type RebalanceRecordInventoryParameters } from '@provablehq/veil-core'
import { planInventory, type PlanInventoryParameters } from './planInventory.js'

/** Combines DEX token resolution with core inventory execution limits. */
export type RebalanceInventoryParameters = PlanInventoryParameters & Omit<RebalanceRecordInventoryParameters, 'plan'>

/**
 * Rebalances a DEX token's underlying private inventory through core join/split actions.
 * Scans, plans, signs and waits for each dependent transition using shared reservations.
 * @param client Account client with recordManagement.enabled for coordinated inventory execution.
 * @param params Token, target, API, and bounded execution options.
 * @returns Completed progress or a resumable interruption.
 * @throws On unsupported assets or invalid targets before submission.
 * @example
 * import type { WalletClient } from '@provablehq/veil-core'
 * import { parseUnits, type ShieldSwapActions } from '@provablehq/shield-swap-sdk'
 *
 * async function prepareUsdcxInventory(client: WalletClient & ShieldSwapActions) {
 *   // Enable recordManagement on the client before executing maintenance.
 *   // This convenience action creates a fresh plan from the current inventory.
 *   // For a reviewed plan, call client.rebalanceRecordInventory({ plan }).
 *   // Extend a wallet client with shieldSwapActions({ api: {} }) first.
 *   const token = await client.tokenData('USDCx')
 *   const result = await client.rebalanceInventory({
 *     token: token.id,
 *     target: {
 *       records: 6,
 *       minRecordAmount: parseUnits('0.1', token.decimals),
 *       distribution: 'balanced',
 *       toleranceBps: 0,
 *     },
 *     maxTransactions: 24,
 *     timeoutMs: 120_000,
 *     pollIntervalMs: 2_000,
 *     maxFeeMicrocredits: 10_000_000n,
 *   })
 *   console.log('Transactions:', result.transactionIds)
 *   if (result.status === 'interrupted') {
 *     // Stop dependent swaps. Reconcile the shared journal before replanning;
 *     // previously accepted joins or splits remain effective.
 *     throw new Error(result.reason ?? 'Inventory maintenance interrupted')
 *   }
 *   return result
 * }
 */
export async function rebalanceInventory(client: Client, params: RebalanceInventoryParameters): Promise<InventoryResult> {
  // Plan joins and splits for the DEX token's underlying asset. Core reserves
  // the inputs and waits for confirmed outputs before executing dependent steps.
  const plan = await planInventory(client, params)
  return rebalanceRecordInventory(client, { ...params, plan })
}
