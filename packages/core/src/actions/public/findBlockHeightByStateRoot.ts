import type { Client } from '../../clients/createClient.js'

export type FindBlockHeightByStateRootParameters = { stateRoot: string }
export type FindBlockHeightByStateRootReturnType = number

export async function findBlockHeightByStateRoot(
  client: Client,
  params: FindBlockHeightByStateRootParameters,
): Promise<FindBlockHeightByStateRootReturnType> {
  return client.request({
    method: 'findBlockHeightByStateRoot',
    params: { stateRoot: params.stateRoot },
  }) as Promise<FindBlockHeightByStateRootReturnType>
}
