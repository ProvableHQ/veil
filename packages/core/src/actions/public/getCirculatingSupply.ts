import type { Client } from '../../clients/createClient.js'

export type GetCirculatingSupplyReturnType = unknown

export async function getCirculatingSupply(client: Client): Promise<GetCirculatingSupplyReturnType> {
  return client.request({ method: 'getCirculatingSupply' })
}
