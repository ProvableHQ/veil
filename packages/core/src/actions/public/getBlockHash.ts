import type { Client } from '../../clients/createClient.js'

/** Hash (`ab1...`) of the latest block. */
export type GetBlockHashReturnType = string

/**
 * Retrieves the hash of the latest block.
 *
 * Queries the connected Aleo node, so it hits the network. Use it for a
 * chain-tip identifier; `getBlockNumber` gives the tip as a height
 * instead.
 *
 * @param client Client whose transport serves the query.
 * @returns The hash of the block at the current chain tip.
 *
 * @example
 * const hash = await client.getBlockHash()
 */
export async function getBlockHash(client: Client): Promise<GetBlockHashReturnType> {
  return client.request({ method: 'getBlockHashLatest' }) as Promise<GetBlockHashReturnType>
}
