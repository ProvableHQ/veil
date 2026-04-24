import type { Client } from '../../clients/createClient.js'
import type { TvlEntry } from '../../types/network.js'

export type GetTvlReturnType = TvlEntry[]

export async function getTvl(client: Client): Promise<GetTvlReturnType> {
  return client.request({ method: 'getTvl' }) as Promise<GetTvlReturnType>
}
