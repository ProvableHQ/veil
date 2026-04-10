import type { Client } from '../../clients/createClient.js'

export type GetCommitteeParameters = { height?: number }
export type GetCommitteeReturnType = unknown

export async function getCommittee(
  client: Client,
  params: GetCommitteeParameters = {},
): Promise<GetCommitteeReturnType> {
  return client.request({
    method: 'getCommittee',
    params: { height: params.height },
  })
}
