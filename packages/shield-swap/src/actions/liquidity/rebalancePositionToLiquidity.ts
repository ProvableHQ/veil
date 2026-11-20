import type { Client } from '@provablehq/veil-core'
import { rebalancePosition, type RebalancePositionParameters, type RebalancePositionReturnType } from './rebalancePosition.js'
import { liquidityRebalanceParameters } from './internal.js'

/**
 * Configures {@link rebalancePositionToLiquidity}; shared options follow {@link RebalancePositionParameters}.
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
export type RebalancePositionToLiquidityParameters = Omit<RebalancePositionParameters, 'liquidityTarget' | 'maxFunding0' | 'maxFunding1'> & {
  liquidityTarget: bigint
  maxFunding0?: never
  maxFunding1?: never
  amount0Desired: bigint
  amount1Desired: bigint
}

/** Returns the transaction, successor identity, and submitted plan. */
export type RebalancePositionToLiquidityReturnType = RebalancePositionReturnType

/**
 * Enforces exact successor liquidity with bounded token consumption.
 *
 * Uses actual recovered funds at execution. At least one token bound must be flexible. Insufficient funds reject instead of reducing liquidity.
 * Calls rebalancePosition, reads chain state, and signs, proves, and submits through the account.
 *
 * @param client A Veil wallet client.
 * @param params The position, replacement range, and amount constraints.
 * @returns The submitted transaction, successor identity when available, and plan.
 * @throws When the target is not positive, caps are missing, or both bounds are exact.
 *
 * @example
 * const result = await rebalancePositionToLiquidity(client, {
 *   poolKey, positionTokenId, tickLower: -400, tickUpper: 400,
 *   liquidityTarget: 1000000n, amount0Desired: 50000n, amount1Desired: 50000n,
 * })
 */
export async function rebalancePositionToLiquidity(client: Client, params: RebalancePositionToLiquidityParameters): Promise<RebalancePositionToLiquidityReturnType> {
  return rebalancePosition(client, liquidityRebalanceParameters(params))
}
