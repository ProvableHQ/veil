import type { Client } from '../../clients/createClient.js'

/** Circulating supply in credits (not microcredits). */
export type GetCirculatingSupplyReturnType = number

export async function getCirculatingSupply(client: Client): Promise<GetCirculatingSupplyReturnType> {
  return client.request({ method: 'getCirculatingSupply' }) as Promise<GetCirculatingSupplyReturnType>
}
