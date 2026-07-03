import type { Client } from '../../clients/createClient.js'
import type { TvlEntry } from '../../types/network.js'

/** Total value locked per protocol, in credits (not microcredits). */
export type GetTvlReturnType = TvlEntry[]

/**
 * Fetches the total value locked in each DeFi protocol on the network.
 *
 * Values are reported in credits, not microcredits. Queries the connected
 * node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @returns One entry per protocol with its locked value in credits.
 *
 * @example
 * const tvl = await client.getTvl()
 */
export async function getTvl(client: Client): Promise<GetTvlReturnType> {
  return client.request({ method: 'getTvl' }) as Promise<GetTvlReturnType>
}
