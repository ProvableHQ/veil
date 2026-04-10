import type { Client } from '../../clients/createClient.js'
import type { Block } from '../../types/block.js'

export type GetBlocksParameters = { start: number; end: number }
export type GetBlocksReturnType = Block[]

export async function getBlocks(
  client: Client,
  params: GetBlocksParameters,
): Promise<GetBlocksReturnType> {
  return client.request({
    method: 'getBlocks',
    params: { start: params.start, end: params.end },
  }) as Promise<GetBlocksReturnType>
}
