import type { Client } from '@provablehq/veil-core'
import { planRebalance, type PlanRebalanceParameters, type RebalancePlan } from './planRebalance.js'
import { exactRebalanceParameters } from './internal.js'

/**
 * Configures {@link planRebalanceExactAmounts}; shared options follow {@link PlanRebalanceParameters}.
 */
export type PlanRebalanceExactAmountsParameters = PlanRebalanceParameters

/** Returns the prepared request and advisory estimates. */
export type PlanRebalanceExactAmountsReturnType = RebalancePlan

/**
 * Plans a rebalance that enforces exact quoted recovery and deposit amounts.
 *
 * A positive target and equal minimum/desired bounds retain strict quote accounting. Price or fee changes can reject the transaction.
 * Reads chain state without signing or submitting.
 *
 * @param client A Veil read client.
 * @param params The position, replacement range, and amount constraints.
 * @returns A plan for rebalancePosition; amount-driven liquidity is an estimate.
 * @throws When the target is zero or a token minimum differs from its desired amount.
 *
 * @example
 * const result = await planRebalanceExactAmounts(client, {
 *   poolKey, positionTokenId, tickLower: -400, tickUpper: 400,
 *   liquidityTarget: 1000000n,
 * })
 */
export async function planRebalanceExactAmounts(client: Client, params: PlanRebalanceExactAmountsParameters): Promise<PlanRebalanceExactAmountsReturnType> {
  return planRebalance(client, exactRebalanceParameters(params))
}
