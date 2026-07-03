import type { Client } from '../../clients/createClient.js'
import type { Block } from '../../types/block.js'

/**
 * Parameters for {@link getBlocks}.
 *
 * @property start First block height (u32) of the range, inclusive.
 * @property end Last block height (u32) of the range, inclusive. The node
 *   caps a single request at 50 blocks.
 */
export type GetBlocksParameters = { start: number; end: number }

/** Blocks in the requested range, in ascending height order. */
export type GetBlocksReturnType = Block[]

/**
 * Retrieves a range of blocks by height.
 *
 * Queries the connected Aleo node, so it hits the network. Applies when
 * scanning a window of chain history; for a single block use `getBlock`. The
 * node serves at most 50 blocks per request, so page larger ranges.
 *
 * @param client Client whose transport serves the query.
 * @param params Height range to fetch.
 * @returns The blocks in the range, ascending by height.
 *
 * @example
 * const blocks = await client.getBlocks({ start: 100, end: 110 })
 */
export async function getBlocks(
  client: Client,
  params: GetBlocksParameters,
): Promise<GetBlocksReturnType> {
  return client.request({
    method: 'getBlocks',
    params: { start: params.start, end: params.end },
  }) as Promise<GetBlocksReturnType>
}
