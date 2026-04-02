import type { Client } from '../../clients/createClient.js'
import type { Block } from '../../types/block.js'

export type GetBlockParameters = { height?: number; hash?: string }
export type GetBlockReturnType = Block

export async function getBlock(client: Client, params: GetBlockParameters): Promise<GetBlockReturnType> {
  if (params.hash) {
    return client.request({ method: 'getBlockByHash', params: { hash: params.hash } }) as Promise<GetBlockReturnType>
  }
  return client.request({ method: 'getBlock', params: { height: params.height } }) as Promise<GetBlockReturnType>
}
