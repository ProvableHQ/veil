import type { Client } from '@provablehq/veil-core'
import { rebalancePosition, type RebalancePositionParameters, type RebalancePositionReturnType } from './rebalancePosition.js'
import type { RebalanceSizing } from './planRebalance.js'
import { exactRebalanceParameters } from './internal.js'

/**
 * Configures {@link rebalancePositionExactAmounts}; shared options follow {@link RebalancePositionParameters}.
 */
export type RebalancePositionExactAmountsParameters = RebalancePositionParameters & RebalanceSizing

/** Returns the transaction, successor identity, and submitted plan. */
export type RebalancePositionExactAmountsReturnType = RebalancePositionReturnType

/**
 * Enforces exact quoted recovery and deposit amounts.
 *
 * A positive target and equal minimum/desired bounds retain strict quote accounting. Price or fee changes can reject the transaction.
 * Calls rebalancePosition, reads chain state, and signs, proves, and submits through the account.
 *
 * @param client A Veil wallet client.
 * @param params The position, replacement range, and amount constraints.
 * @returns The submitted transaction, successor identity when available, and plan.
 * @throws When the target is zero or a token minimum differs from its desired amount.
 *
 * @example
 * const result = await rebalancePositionExactAmounts(client, {
 *   poolKey, positionTokenId, tickLower: -400, tickUpper: 400,
 *   liquidityTarget: 1000000n,
 * })
 */
export async function rebalancePositionExactAmounts(client: Client, params: RebalancePositionExactAmountsParameters): Promise<RebalancePositionExactAmountsReturnType> {
  return rebalancePosition(client, exactRebalanceParameters(params))
}
