import type { Client } from '../../clients/createClient.js'

/** Circulating supply in credits (not microcredits). */
export type GetCirculatingSupplyReturnType = number

/**
 * Retrieves the circulating supply of Aleo credits.
 *
 * Queries the connected Aleo node, so it hits the network. Circulating supply
 * excludes locked and unvested credits; `getTotalSupply` reports the total
 * minted supply instead.
 *
 * @param client Client whose transport serves the query.
 * @returns The circulating supply in credits (not microcredits).
 *
 * @example
 * const supply = await client.getCirculatingSupply()
 */
export async function getCirculatingSupply(client: Client): Promise<GetCirculatingSupplyReturnType> {
  return client.request({ method: 'getCirculatingSupply' }) as Promise<GetCirculatingSupplyReturnType>
}
