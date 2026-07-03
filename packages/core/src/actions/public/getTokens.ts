import type { Client } from '../../clients/createClient.js'
import type { TokenPage } from '../../types/network.js'

/** A page of registered tokens with pagination metadata. */
export type GetTokensReturnType = TokenPage

/**
 * Fetches the tokens registered on the network.
 *
 * Returns registry entries with market data where available, plus pagination
 * metadata. Reach for this to list tokens; use `getTokenDetails` for one
 * token's entry and price history. Queries the connected node, so it hits the
 * network.
 *
 * @param client Client whose transport serves the query.
 * @returns A page of token registry entries.
 *
 * @example
 * const { data, pagination } = await client.getTokens()
 */
export async function getTokens(client: Client): Promise<GetTokensReturnType> {
  return client.request({ method: 'getTokens' }) as Promise<GetTokensReturnType>
}
