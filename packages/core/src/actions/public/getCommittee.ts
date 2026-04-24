import type { Client } from '../../clients/createClient.js'
import type { Committee } from '../../types/network.js'

export type GetCommitteeParameters = { height?: number }
export type GetCommitteeReturnType = Committee

export async function getCommittee(
  client: Client,
  params: GetCommitteeParameters = {},
): Promise<GetCommitteeReturnType> {
  return client.request({
    method: 'getCommittee',
    params: { height: params.height },
  }) as Promise<GetCommitteeReturnType>
}
