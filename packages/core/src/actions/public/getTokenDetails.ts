import type { Client } from '../../clients/createClient.js'

export type TokenInfo = {
  token_id: string
  token_id_datatype: string
  symbol: string
  display: string
  program_name: string
  decimals: number
  /** All monetary/large values are strings to preserve precision for u128+ amounts. */
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

export type TokenPricePoint = {
  day: string
  price_usd: string | null
  volume_24h: string | null
  total_market_cap: string | null
}

export type TokenPriceHistoryPagination = {
  limit: number
  offset: number
  total_count: number
  has_next: boolean
  has_previous: boolean
}

export type GetTokenDetailsParameters = {
  /** Program ID hosting the token (e.g. 'token_registry.aleo'). Required. */
  programId: string
  /**
   * Token ID within the program. Required in practice — the endpoint returns
   * `token: null` and `price_history.pagination: null` when this is omitted.
   */
  tokenId?: string
  /** 0–50, defaults to 50 server-side. */
  limit?: number
  /** Defaults to 0 server-side. */
  offset?: number
  /** Defaults to `'daily'` server-side. */
  granularity?: 'hourly' | 'daily'
}

export type GetTokenDetailsReturnType = {
  /** `null` when `tokenId` was omitted or the token is not registered. */
  token: TokenInfo | null
  price_history: {
    /** `null` when the query did not match any price-history rows. */
    pagination: TokenPriceHistoryPagination | null
    data: TokenPricePoint[]
  }
}

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
