import type { Client } from '../../clients/createClient.js'

/** Decimal APY for the network (e.g. 10.9 ≈ 10.9%). */
export type GetApyReturnType = number

export async function getApy(client: Client): Promise<GetApyReturnType> {
  return client.request({ method: 'getApy' }) as Promise<GetApyReturnType>
}
