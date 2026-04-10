import type { Client } from '../../clients/createClient.js'

export type GetTvlReturnType = unknown

export async function getTvl(client: Client): Promise<GetTvlReturnType> {
  return client.request({ method: 'getTvl' })
}
