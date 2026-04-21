import type { Client } from '../../clients/createClient.js'
import type { StakingEarnings } from '../../types/network.js'

export type GetStakingEarningsParameters = { address: string }
export type GetStakingEarningsReturnType = StakingEarnings

export async function getStakingEarnings(
  client: Client,
  params: GetStakingEarningsParameters,
): Promise<GetStakingEarningsReturnType> {
  return client.request({
    method: 'getStakingEarnings',
    params: { address: params.address },
  }) as Promise<GetStakingEarningsReturnType>
}
