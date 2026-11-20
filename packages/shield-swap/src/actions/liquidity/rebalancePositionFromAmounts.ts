import type { Client } from '@provablehq/veil-core'
import { rebalancePosition, type RebalancePositionParameters, type RebalancePositionReturnType } from './rebalancePosition.js'
import { amountRebalanceParameters } from './internal.js'

/**
 * Configures {@link rebalancePositionFromAmounts}; shared options follow {@link RebalancePositionParameters}.
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
export type RebalancePositionFromAmountsParameters = Omit<RebalancePositionParameters, 'liquidityTarget' | 'maxFunding0' | 'maxFunding1'> & {
  liquidityTarget?: 0n
  maxFunding0?: never
  maxFunding1?: never
  amount0Desired: bigint
  amount1Desired: bigint
}

/** Returns the transaction, successor identity, and submitted plan. */
export type RebalancePositionFromAmountsReturnType = RebalancePositionReturnType

/**
 * Derives successor liquidity from available tokens at execution.
 *
 * Uses a zero contract target, capped recovery plus fixed funding minus fixed refunds. Unused tokens remain collectible on the successor; no swap occurs.
 * Calls rebalancePosition, reads chain state, and signs, proves, and submits through the account.
 *
 * @param client A Veil wallet client.
 * @param params The position, replacement range, and amount constraints.
 * @returns The submitted transaction, successor identity when available, and plan.
 * @throws When a positive target, quote-time funding budget, or invalid token bound is supplied.
 *
 * @example
 * const result = await rebalancePositionFromAmounts(client, {
 *   poolKey, positionTokenId, tickLower: -400, tickUpper: 400,
 *   amount0Desired: 50000n, amount1Desired: 50000n,
 * })
 */
export async function rebalancePositionFromAmounts(client: Client, params: RebalancePositionFromAmountsParameters): Promise<RebalancePositionFromAmountsReturnType> {
  return rebalancePosition(client, amountRebalanceParameters(params))
}
