import type { Client } from '../../clients/createClient.js'
import type { StakingEarnings } from '../../types/network.js'

/**
 * Parameters for {@link getStakingEarnings}.
 *
 * @property address Staker address whose earnings to fetch.
 */
export type GetStakingEarningsParameters = { address: string }

/** Cumulative staking rewards and the block height they were computed at. */
export type GetStakingEarningsReturnType = StakingEarnings

/**
 * Fetches the cumulative staking rewards earned by an address.
 *
 * Rewards are reported in microcredits (u64), together with the block height
 * the total was computed at. Use it to show a staker's lifetime earnings;
 * use `getApy` or `getValidatorApy` for forward-looking yield.
 * Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Staker to look up.
 * @returns Total rewards in microcredits and the height of the computation.
 *
 * @example
 * const earnings = await client.getStakingEarnings({ address: 'aleo1…' })
 */
export async function getStakingEarnings(
  client: Client,
  params: GetStakingEarningsParameters,
): Promise<GetStakingEarningsReturnType> {
  return client.request({
    method: 'getStakingEarnings',
    params: { address: params.address },
  }) as Promise<GetStakingEarningsReturnType>
}
