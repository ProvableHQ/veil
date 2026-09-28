import type { Client } from '@provablehq/veil-core'
import type { ApiClient } from '../../api/client.js'
import { SHIELD_SWAP } from '../../constants.js'
import { tokenData, type TokenInfo } from '../../utils/tokens.js'
import { formatUnits, parseUnits } from '../../utils/units.js'
import { assertQuote, assertQuoteAmount, assertQuoteSlippage, quoteNetwork } from './internal.js'

/**
 * Describes one ordered pool traversal in a swap quote.
 * @property poolKey Pool key field literal.
 * @property tokenInId Input token id field literal.
 * @property tokenOutId Output token id field literal.
 */
export type SwapQuoteHop = {
  readonly poolKey: string
  readonly tokenInId: string
  readonly tokenOutId: string
}

/**
 * Carries the terms accepted by `swap({ quote })` for one exact-input trade.
 * Quotes are unsigned estimates, not liquidity reservations. Amounts use bigint;
 * JSON consumers must encode those amounts as integer strings.
 * @property version Quote structure version, currently 1.
 * @property network Transport network the quote belongs to.
 * @property program Core AMM program the quote targets.
 * @property from Resolved input token metadata.
 * @property to Resolved output token metadata.
 * @property amountIn Exact input amount in raw base units (positive u128).
 * @property expectedOut API-estimated final output in raw base units (positive u128).
 * @property minOut Exact positive u128 output floor submitted to the contract.
 * @property slippageBps Slippage applied once to final output, in whole basis points.
 * @property hops Ordered route of 1–3 connected pools.
 * @property quotedAt Local request-start time in Unix milliseconds; not an indexer observation time.
 * @property expiresAt Local preparation expiry in Unix milliseconds, 60 seconds after quotedAt.
 * @property protocolRevision Protocol configuration revision reported by the API, informational.
 * @property protocolConfigObservedBlock Configuration observation height, when reported; not a pool-state snapshot height.
 */
export type SwapQuote = {
  readonly version: 1
  readonly network: string
  readonly program: string
  readonly from: Readonly<TokenInfo>
  readonly to: Readonly<TokenInfo>
  readonly amountIn: bigint
  readonly expectedOut: bigint
  readonly minOut: bigint
  readonly slippageBps: number
  readonly hops: readonly SwapQuoteHop[]
  readonly quotedAt: number
  readonly expiresAt: number
  readonly protocolRevision: number
  readonly protocolConfigObservedBlock?: number
}

/**
 * Describes an exact-input quote request using indexed DEX state.
 * @property from Input token symbol or id.
 * @property to Output token symbol or id.
 * @property amountIn Positive decimal string in input-token units (e.g. `'1.5'`),
 * or bigint in raw base units (u128). Strings must fit the token's decimals;
 * numbers and excess precision are rejected rather than rounded.
 * @property slippageBps Whole basis points below expected output; defaults to 50 (0.5%). A zero floor is rejected.
 * @property program Core AMM deployment; defaults to the decorator's program or shield_swap.aleo.
 * @property api DEX API client; defaults to the decorated client's API. Required on a bare client.
 */
export type QuoteParameters = {
  from: string
  to: string
  amountIn: bigint | string
  slippageBps?: number
  program?: string
  api?: ApiClient
}

/**
 * Quotes an exact-input swap along the indexed API's selected 1–3-hop route.
 * Trusts the API's estimated output and converts it to raw token units without
 * floating-point arithmetic. Fetches only token metadata and the selected route;
 * no pool scans, tick reads, chain reads, signing or proving occur here.
 * The estimate is advisory; execution preserves the quoted minimum output.
 * @param client Client whose transport identifies the execution network.
 * @param params Tokens, decimal-string or raw-bigint input, slippage and optional API/deployment configuration.
 * @returns A quote that can be passed directly to swap.
 * @throws When amounts, routing or network are invalid, the API estimate is
 * missing or unusable, the minimum is zero, or the quote expires while loading.
 * @example
 * const offer = await quote(client, { api, from: 'USDCx', to: 'ETH', amountIn: '1.5' })
 * const handle = await swap(client, { quote: offer })
 */
export async function quote(client: Client, params: QuoteParameters): Promise<SwapQuote> {
  if (typeof params.amountIn !== 'string') assertQuoteAmount(params.amountIn, 'amountIn')
  const slippageBps = params.slippageBps ?? 50
  assertQuoteSlippage(slippageBps)
  const network = quoteNetwork(client)
  const quotedAt = Date.now()
  const api = params.api ?? (client as Client & { api?: ApiClient }).api
  if (!api) throw new Error('quote requires a DEX API client; configure shieldSwapActions({ api: {} }) or pass api')
  const [from, to] = await Promise.all([tokenData(api, params.from), tokenData(api, params.to)])
  if (from.id === to.id) throw new Error('Cannot quote a token for itself')
  const amountIn = typeof params.amountIn === 'string' ? parseUnits(params.amountIn, from.decimals) : params.amountIn
  assertQuoteAmount(amountIn, 'amountIn')
  const route = (await api.getRoute({ token_in: from.id, token_out: to.id, amount_in: formatUnits(amountIn, from.decimals) })).data
  if (route.token_in !== from.id || route.token_out !== to.id) throw new Error('API route endpoints do not match the quote request')
  if (!route.hops?.length || route.hops.length > 3) throw new Error('Quote route must contain 1–3 hops')
  if (!route.estimated_amount_out) throw new Error('API route has no output estimate; request another quote')
  const expectedOut = parseUnits(route.estimated_amount_out, to.decimals)
  const result: SwapQuote = {
    version: 1, network, program: params.program ?? SHIELD_SWAP,
    from: { ...from }, to: { ...to }, amountIn, expectedOut,
    minOut: expectedOut * BigInt(10_000 - slippageBps) / 10_000n,
    slippageBps,
    hops: route.hops.map((hop) => ({ poolKey: hop.pool_key, tokenInId: hop.token_in, tokenOutId: hop.token_out })),
    quotedAt, expiresAt: quotedAt + 60_000,
    protocolRevision: route.protocol_revision,
    ...(route.protocol_config_observed_block != null ? { protocolConfigObservedBlock: route.protocol_config_observed_block } : {}),
  }
  assertQuote(client, result)
  return result
}
