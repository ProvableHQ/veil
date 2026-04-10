import type { Client } from '../../clients/createClient.js'

export type GetBlockSummaryReturnType = unknown

export async function getBlockSummary(client: Client): Promise<GetBlockSummaryReturnType> {
  return client.request({ method: 'getBlockSummary' })
}
