import type { Client } from '../../clients/createClient.js'
import type { BlockSummary } from '../../types/network.js'

/** Array of recent block summaries, newest first. */
export type GetBlockSummaryReturnType = BlockSummary[]

/**
 * Retrieves summaries of the most recent blocks.
 *
 * Queries the connected Aleo node, so it hits the network. Reach for it to
 * populate an explorer-style recent-blocks view without downloading full
 * blocks; use `getBlocks` when you need complete block contents.
 *
 * @param client Client whose transport serves the query.
 * @returns Summaries of the latest blocks, newest first.
 *
 * @example
 * const summaries = await client.getBlockSummary()
 */
export async function getBlockSummary(client: Client): Promise<GetBlockSummaryReturnType> {
  return client.request({ method: 'getBlockSummary' }) as Promise<GetBlockSummaryReturnType>
}
