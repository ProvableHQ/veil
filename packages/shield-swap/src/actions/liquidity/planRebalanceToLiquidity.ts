import type { Client } from '@provablehq/veil-core'
import { planRebalance, type PlanRebalanceParameters, type RebalancePlan } from './planRebalance.js'
import { liquidityRebalanceParameters } from './internal.js'

/**
 * Configures {@link planRebalanceToLiquidity}; shared options follow {@link PlanRebalanceParameters}.
 * @property amount0Desired Maximum token0 consumed (u128 raw units).
 * @property amount1Desired Maximum token1 consumed (u128 raw units).
 * @property amount0Min Minimum token0 consumed; defaults to zero.
 * @property amount1Min Minimum token1 consumed; defaults to zero.
 * @property funded0 Fixed extra token0 funding; defaults to zero.
 * @property funded1 Fixed extra token1 funding; defaults to zero.
 * @property refund0 Fixed immediate token0 payout; defaults to zero.
 * @property refund1 Fixed immediate token1 payout; defaults to zero.
 * @property liquidityTarget Positive exact successor liquidity (u128).
 */
export type PlanRebalanceToLiquidityParameters = Omit<PlanRebalanceParameters, 'liquidityTarget' | 'maxFunding0' | 'maxFunding1'> & {
  liquidityTarget: bigint
  maxFunding0?: never
  maxFunding1?: never
  amount0Desired: bigint
  amount1Desired: bigint
}

/** Returns the prepared request and advisory estimates. */
export type PlanRebalanceToLiquidityReturnType = RebalancePlan & { amount0Desired: bigint; amount1Desired: bigint }

/**
 * Plans a rebalance that enforces exact successor liquidity with bounded token consumption.
 *
 * Uses actual recovered funds at execution. At least one token bound must be flexible. Insufficient funds reject instead of reducing liquidity.
 * Reads chain state without signing or submitting.
 *
 * @param client A Veil read client.
 * @param params The position, replacement range, and amount constraints.
 * @returns A plan for rebalancePosition; amount-driven liquidity is an estimate.
 * @throws When the target is not positive, caps are missing, or both bounds are exact.
 *
 * @example
 * const result = await planRebalanceToLiquidity(client, {
 *   poolKey, positionTokenId, tickLower: -400, tickUpper: 400,
 *   liquidityTarget: 1000000n, amount0Desired: 50000n, amount1Desired: 50000n,
 * })
 */
export async function planRebalanceToLiquidity(client: Client, params: PlanRebalanceToLiquidityParameters): Promise<PlanRebalanceToLiquidityReturnType> {
  const request = liquidityRebalanceParameters(params)
  const plan = await planRebalance(client, request)
  return { ...plan, amount0Desired: request.amount0Desired, amount1Desired: request.amount1Desired }
}
