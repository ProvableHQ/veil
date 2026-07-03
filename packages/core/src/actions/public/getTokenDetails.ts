import type { Client } from '../../clients/createClient.js'

/**
 * A token registered in the on-chain token registry, with market data where available.
 *
 * Monetary and large numeric values come as decimal strings to preserve
 * precision for u128+ amounts; market-data fields are `null` when no data is
 * available for the token.
 *
 * @property token_id Token ID literal within its program.
 * @property token_id_datatype Aleo type of `token_id`, such as `field` or `u128`.
 * @property symbol Ticker symbol.
 * @property display Display name.
 * @property program_name Program hosting the token, such as `token_registry.aleo`.
 * @property decimals Decimal places used to render amounts.
 * @property total_supply Total supply in base units, as a decimal string.
 * @property verified Whether the registry lists the token as verified.
 * @property token_icon_url Icon URL, or `null` when none is registered.
 * @property compliance_freeze_list Compliance freeze list, or `null` when none applies.
 * @property price USD price as a decimal string, or `null`.
 * @property price_change_percentage_24h 24-hour price change in percent, as a decimal string, or `null`.
 * @property fully_diluted_value Fully diluted USD value as a decimal string, or `null`.
 * @property total_market_cap USD market cap as a decimal string, or `null`.
 * @property volume_24h 24-hour USD volume as a decimal string, or `null`.
 */
export type TokenInfo = {
  token_id: string
  token_id_datatype: string
  symbol: string
  display: string
  program_name: string
  decimals: number
  total_supply: string
  verified: boolean
  token_icon_url: string | null
  compliance_freeze_list: unknown | null
  price: string | null
  price_change_percentage_24h: string | null
  fully_diluted_value: string | null
  total_market_cap: string | null
  volume_24h: string | null
}

/**
 * One point in a token's price history.
 *
 * @property day Bucket timestamp, as an ISO-8601 string.
 * @property price_usd USD price as a decimal string, or `null` when no data exists for the bucket.
 * @property volume_24h 24-hour USD volume as a decimal string, or `null`.
 * @property total_market_cap USD market cap as a decimal string, or `null`.
 */
export type TokenPricePoint = {
  day: string
  price_usd: string | null
  volume_24h: string | null
  total_market_cap: string | null
}

/**
 * Pagination metadata for a token price-history page.
 *
 * @property limit Page size the server applied.
 * @property offset Row offset of this page.
 * @property total_count Total rows matching the query.
 * @property has_next Whether another page follows.
 * @property has_previous Whether a page precedes this one.
 */
export type TokenPriceHistoryPagination = {
  limit: number
  offset: number
  total_count: number
  has_next: boolean
  has_previous: boolean
}

/**
 * Parameters for {@link getTokenDetails}.
 *
 * @property programId Program ID hosting the token (e.g. 'token_registry.aleo'). Required.
 * @property tokenId Token ID within the program. Required in practice — the
 *   endpoint returns `token: null` and `price_history.pagination: null` when
 *   this is omitted.
 * @property limit Price-history page size, 0–50. Defaults to 50 server-side.
 * @property offset Price-history row offset. Defaults to 0 server-side.
 * @property granularity Price-history bucket size. Defaults to `'daily'` server-side.
 */
export type GetTokenDetailsParameters = {
  programId: string
  tokenId?: string
  limit?: number
  offset?: number
  granularity?: 'hourly' | 'daily'
}

/**
 * A token's registry entry and one page of its price history.
 *
 * @property token The registry entry, or `null` when `tokenId` was omitted or
 *   the token is not registered.
 * @property price_history One page of price points; `pagination` is `null`
 *   when the query did not match any price-history rows.
 */
export type GetTokenDetailsReturnType = {
  token: TokenInfo | null
  price_history: {
    pagination: TokenPriceHistoryPagination | null
    data: TokenPricePoint[]
  }
}

/**
 * Fetches a token's registry entry and price history.
 *
 * Reach for this for one token's metadata and market data; use `getTokens` to
 * list registered tokens. Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Token to look up and price-history paging options.
 * @returns The registry entry (or `null` when unregistered) and a page of price points.
 *
 * @example
 * const details = await client.getTokenDetails({
 *   programId: 'token_registry.aleo',
 *   tokenId: '1234…field',
 * })
 */
export async function getTokenDetails(
  client: Client,
  params: GetTokenDetailsParameters,
): Promise<GetTokenDetailsReturnType> {
  return client.request({
    method: 'getTokenDetails',
    params: {
      programId: params.programId,
      tokenId: params.tokenId,
      limit: params.limit,
      offset: params.offset,
      granularity: params.granularity,
    },
  }) as Promise<GetTokenDetailsReturnType>
}
