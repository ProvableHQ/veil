import type { Client } from '../../clients/createClient.js'
import type { BlockSummary } from '../../types/network.js'

/** Array of recent block summaries, newest first. */
export type GetBlockSummaryReturnType = BlockSummary[]

export async function getBlockSummary(client: Client): Promise<GetBlockSummaryReturnType> {
  return client.request({ method: 'getBlockSummary' }) as Promise<GetBlockSummaryReturnType>
}
