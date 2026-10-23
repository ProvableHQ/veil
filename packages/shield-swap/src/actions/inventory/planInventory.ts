import { planRecordInventory, type Client, type InventoryPlan, type InventoryTarget } from '@provablehq/veil-core'
import type { ApiClient } from '../../api/client.js'
import { tokenData } from '../../utils/tokens.js'

/**
 * Defines the DEX token and desired record count and distribution.
 * @property token Token symbol or DEX token id.
 * @property target Desired count, minimum amount and distribution in underlying base units.
 * @property api Token metadata API; the decorator supplies its configured API.
 * @property maxTransactions Maximum planned operations, defaults to 100.
 */
export type PlanInventoryParameters = { token: string; target: InventoryTarget; api: ApiClient; maxTransactions?: number }

/**
 * Plans inventory for a DEX token's underlying asset, using core record tooling.
 * Resolves metadata and validates the deployed token interface; never signs.
 * @param client Account client; enabled record management excludes shared reservations.
 * @param params Token, target, API and optional operation limit.
 * @returns A core inventory plan for the underlying program, not the AMM wrapper.
 * @throws When token metadata or its supported underlying program cannot be resolved.
 * @example
 * import type { Client } from '@provablehq/veil-core'
 * import { planInventory, tokenData, parseUnits, type ApiClient } from '@provablehq/shield-swap-sdk'
 *
 * async function previewUsdcxInventory(client: Client, api: ApiClient) {
 *   const token = await tokenData(api, 'USDCx')
 *   const plan = await planInventory(client, {
 *     api,
 *     token: token.id,
 *     target: {
 *       records: 6,
 *       minRecordAmount: parseUnits('0.1', token.decimals),
 *       distribution: 'balanced',
 *       toleranceBps: 0,
 *     },
 *     maxTransactions: 24,
 *   })
 *   // The plan names the spendable underlying program, not its AMM wrapper.
 *   console.log('Asset:', plan.asset.program, 'Operations:', plan.steps.length)
 *   // Keep this plan for review; execute it with core rebalanceRecordInventory.
 *   // A client extended with shieldSwapActions supplies api automatically:
 *   // await client.planInventory({ token: 'USDCx', target, maxTransactions: 24 })
 *   return plan
 * }
 */
export async function planInventory(client: Client, params: PlanInventoryParameters): Promise<InventoryPlan> {
  const token = await tokenData(params.api, params.token)
  // Maintenance operates on the spendable underlying token, not the AMM
  // wrapper program used when routing a swap.
  const program = token.underlyingProgram
  if (!program) throw new Error(`Token ${token.symbol} has no underlying record program`)
  // Core resolves record and amount defaults from the underlying program and
  // selects its available join helper when several records need consolidation.
  return planRecordInventory(client, { asset: { program }, target: params.target, maxTransactions: params.maxTransactions })
}
