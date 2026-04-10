import type { Client } from '../../clients/createClient.js'

export type GetBlockHashReturnType = string

export async function getBlockHash(client: Client): Promise<GetBlockHashReturnType> {
  return client.request({ method: 'getBlockHashLatest' }) as Promise<GetBlockHashReturnType>
}
