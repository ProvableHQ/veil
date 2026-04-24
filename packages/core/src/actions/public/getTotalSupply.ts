import type { Client } from '../../clients/createClient.js'

/** Total supply in credits (not microcredits). */
export type GetTotalSupplyReturnType = number

export async function getTotalSupply(client: Client): Promise<GetTotalSupplyReturnType> {
  return client.request({ method: 'getTotalSupply' }) as Promise<GetTotalSupplyReturnType>
}
