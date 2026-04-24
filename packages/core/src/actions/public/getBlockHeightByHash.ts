import type { Client } from '../../clients/createClient.js'

export type GetBlockHeightByHashParameters = { hash: string }
export type GetBlockHeightByHashReturnType = number

export async function getBlockHeightByHash(
  client: Client,
  params: GetBlockHeightByHashParameters,
): Promise<GetBlockHeightByHashReturnType> {
  return client.request({
    method: 'getBlockHeightByHash',
    params: { hash: params.hash },
  }) as Promise<GetBlockHeightByHashReturnType>
}
