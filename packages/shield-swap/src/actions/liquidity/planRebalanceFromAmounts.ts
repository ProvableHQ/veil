import type { Client } from '@provablehq/veil-core'
import { planRebalance, type PlanRebalanceParameters, type RebalancePlan } from './planRebalance.js'
import { amountRebalanceParameters } from './internal.js'

/**
 * Configures {@link planRebalanceFromAmounts}; shared options follow {@link PlanRebalanceParameters}.
 * @property amount0Desired Maximum token0 consumed (u128 raw units).
 * @property amount1Desired Maximum token1 consumed (u128 raw units).
 * @property amount0Min Minimum token0 consumed; defaults to zero.
 * @property amount1Min Minimum token1 consumed; defaults to zero.
 * @property funded0 Fixed extra token0 funding; defaults to zero.
 * @property funded1 Fixed extra token1 funding; defaults to zero.
 * @property refund0 Fixed immediate token0 payout; defaults to zero.
 * @property refund1 Fixed immediate token1 payout; defaults to zero.
 * @property liquidityTarget Optional zero sentinel, accepted from a spread plan. Defaults to zero.
 */
export type PlanRebalanceFromAmountsParameters = Omit<PlanRebalanceParameters, 'liquidityTarget' | 'maxFunding0' | 'maxFunding1'> & {
  liquidityTarget?: 0n
  maxFunding0?: never
  maxFunding1?: never
  amount0Desired: bigint
  amount1Desired: bigint
}

/** Returns the prepared request and advisory estimates. */
export type PlanRebalanceFromAmountsReturnType = RebalancePlan & { amount0Desired: bigint; amount1Desired: bigint; liquidityTarget: 0n }

/**
 * Plans a rebalance that derives successor liquidity from available tokens at execution.
 *
 * Uses a zero contract target, capped recovery plus fixed funding minus fixed refunds. Unused tokens remain collectible on the successor; no swap occurs.
 * Reads chain state without signing or submitting.
 *
 * @param client A Veil read client.
 * @param params The position, replacement range, and amount constraints.
 * @returns A plan for rebalancePosition; amount-driven liquidity is an estimate.
 * @throws When a positive target, quote-time funding budget, or invalid token bound is supplied.
 *
 * @example
 * const result = await planRebalanceFromAmounts(client, {
 *   poolKey, positionTokenId, tickLower: -400, tickUpper: 400,
 *   amount0Desired: 50000n, amount1Desired: 50000n,
 * })
 */
export async function planRebalanceFromAmounts(client: Client, params: PlanRebalanceFromAmountsParameters): Promise<PlanRebalanceFromAmountsReturnType> {
  const request = amountRebalanceParameters(params)
  const plan = await planRebalance(client, request)
  return { ...plan, amount0Desired: request.amount0Desired, amount1Desired: request.amount1Desired, liquidityTarget: 0n }
}
