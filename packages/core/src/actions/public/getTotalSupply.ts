import type { Client } from '../../clients/createClient.js'

export type GetTotalSupplyReturnType = unknown

export async function getTotalSupply(client: Client): Promise<GetTotalSupplyReturnType> {
  return client.request({ method: 'getTotalSupply' })
}
