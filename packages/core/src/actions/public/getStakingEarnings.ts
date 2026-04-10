import type { Client } from '../../clients/createClient.js'

export type GetStakingEarningsParameters = { address: string }
export type GetStakingEarningsReturnType = unknown

export async function getStakingEarnings(
  client: Client,
  params: GetStakingEarningsParameters,
): Promise<GetStakingEarningsReturnType> {
  return client.request({
    method: 'getStakingEarnings',
    params: { address: params.address },
  })
}
