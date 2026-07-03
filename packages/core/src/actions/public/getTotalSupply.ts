import type { Client } from '../../clients/createClient.js'

/** Total supply in credits (not microcredits). */
export type GetTotalSupplyReturnType = number

/**
 * Fetches the total supply of Aleo credits.
 *
 * Reported in credits, not microcredits. Use `getCirculatingSupply` for the
 * circulating portion. Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @returns The total supply in credits.
 *
 * @example
 * const supply = await client.getTotalSupply()
 */
export async function getTotalSupply(client: Client): Promise<GetTotalSupplyReturnType> {
  return client.request({ method: 'getTotalSupply' }) as Promise<GetTotalSupplyReturnType>
}
