import type { Client } from '../../clients/createClient.js'

export type GetApyReturnType = unknown

export async function getApy(client: Client): Promise<GetApyReturnType> {
  return client.request({ method: 'getApy' })
}
