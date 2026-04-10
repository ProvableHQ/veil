import type { Client } from '../../clients/createClient.js'

export type GetStateRootParameters = { height?: number }
export type GetStateRootReturnType = string

export async function getStateRoot(
  client: Client,
  params: GetStateRootParameters = {},
): Promise<GetStateRootReturnType> {
  return client.request({
    method: 'getStateRoot',
    params: { height: params.height },
  }) as Promise<GetStateRootReturnType>
}
