import type { Client } from '../../clients/createClient.js'

export type GetBlockNumberReturnType = bigint

export async function getBlockNumber(client: Client): Promise<GetBlockNumberReturnType> {
  const height = await client.request({ method: 'getLatestHeight' })
  return BigInt(String(height))
}
