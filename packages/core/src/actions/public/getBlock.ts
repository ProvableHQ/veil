import type { Client } from '../../clients/createClient.js'
import type { Block } from '../../types/block.js'

/**
 * Parameters for {@link getBlock}. Provide either a height or a hash.
 *
 * @property height Block height (u32) to fetch. Ignored when `hash` is set.
 * @property hash Block hash (`ab1...`) to fetch. Takes precedence over `height`.
 */
export type GetBlockParameters = { height?: number; hash?: string }

/** The full block, including header, authority, and confirmed transactions. */
export type GetBlockReturnType = Block

/**
 * Retrieves a block by height or by hash.
 *
 * Queries the connected Aleo node, so it hits the network. When both `height`
 * and `hash` are given, `hash` wins. For only the transactions of a block,
 * `getBlockTransactions` is the lighter call.
 *
 * @param client Client whose transport serves the query.
 * @param params Which block to fetch — by height or by hash.
 * @returns The full block at the given height or hash.
 *
 * @example
 * const block = await client.getBlock({ height: 100 })
 */
export async function getBlock(client: Client, params: GetBlockParameters): Promise<GetBlockReturnType> {
  if (params.hash) {
    return client.request({ method: 'getBlockByHash', params: { hash: params.hash } }) as Promise<GetBlockReturnType>
  }
  return client.request({ method: 'getBlock', params: { height: params.height } }) as Promise<GetBlockReturnType>
}
