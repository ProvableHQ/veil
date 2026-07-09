import type { Client } from '@provablehq/veil-core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import { BridgeEnvelopeError } from '../errors/bridgeErrors.js'
import { resolveRouteRefs } from '../lib/asset-resolve.js'
import type { BridgeQuote, GetQuotesMeta } from '../types/bridge.js'

/**
 * Parameters for `getQuotes`. Chains accept the API identifier (`'EVM:1'`)
 * or the display name (`'Ethereum'`), case-insensitively; assets accept the
 * chain-qualified code (`'USDC_ETH'`) or the symbol (`'USDC'`), resolved
 * against the catalog within the given chain; `amountIn` is a decimal string
 * in display units with at most the asset's decimals.
 *
 * @property srcChain Source chain, by identifier or display name.
 * @property destChain Destination chain, by identifier or display name.
 * @property srcAsset Source asset — chain-qualified code, or symbol resolved
 *   on `srcChain`.
 * @property destAsset Destination asset — chain-qualified code, or symbol
 *   resolved on `destChain`.
 * @property amountIn Decimal source amount as a string.
 * @property slippageBps Optional slippage tolerance in basis points, as a
 *   decimal string.
 * @property fromAddress Optional source-chain wallet address; the API uses it
 *   as the default recipient and refund address.
 * @property recipientAddress Destination-chain recipient. Strongly
 *   recommended — some providers (NEAR Intents) skip quoting without it.
 * @property refundAddress Source-chain refund address. Strongly recommended
 *   for the same reason.
 */
export type GetQuotesParameters = {
  srcChain: string
  destChain: string
  srcAsset: string
  destAsset: string
  amountIn: string
  slippageBps?: string | undefined
  fromAddress?: string | undefined
  recipientAddress?: string | undefined
  refundAddress?: string | undefined
}

/**
 * What `getQuotes` resolves with.
 *
 * @property quotes One quote per provider willing to take the route; empty
 *   when no enabled provider will.
 * @property meta Request metadata — `quoteRequestId` identifies this request
 *   in support escalations, `warnings`/`providerErrors` explain skipped or
 *   failed providers.
 */
export type GetQuotesReturnType = {
  quotes: BridgeQuote[]
  meta: GetQuotesMeta
}

/**
 * Fetches cross-chain swap quotes for a route, fanning out to every enabled
 * provider.
 *
 * Hits the bridge API (which in turn queries the providers' own quoting
 * systems); moves no funds. An empty `quotes` array means the route is not
 * live right now — this call doubles as route discovery, since the service
 * has no routes endpoint.
 *
 * Chain names normalize locally (free); passing an asset SYMBOL costs one
 * extra `getAssets` fetch to resolve it — exact codes keep the single
 * request. The returned quotes echo the resolved codes.
 *
 * @param client A client whose transport is `httpBridge`.
 * @param params The route, amount, and addresses — see {@link GetQuotesParameters}.
 * @returns Quotes plus request metadata — see {@link GetQuotesReturnType}.
 * @throws TransportError On a 4xx/5xx response (unknown asset code, chain
 *   mismatch, malformed amount).
 * @throws BridgeError When a symbol matches nothing (or several things) on
 *   its chain.
 * @throws BridgeEnvelopeError When the response envelope is malformed or its
 *   meta block lacks the `quoteRequestId` every quote response carries.
 *
 * @example
 * const { quotes, meta } = await getQuotes(client, {
 *   srcChain: 'ALEO', srcAsset: 'ALEO_MAINNET',
 *   destChain: 'SOLANA', destAsset: 'SOL_SOLANA',
 *   amountIn: '100', recipientAddress: sol, refundAddress: aleo,
 * })
 */
export async function getQuotes(
  client: Client,
  params: GetQuotesParameters,
): Promise<GetQuotesReturnType> {
  const resolved = { ...params, ...(await resolveRouteRefs(client, params)) }

  const response = await client.request({ method: 'getBridgeQuotes', params: resolved })
  const { data, meta } = unwrapEnvelope<BridgeQuote[]>(response, { keepMeta: true })
  // The quotes endpoint always carries a quoteRequestId; downstream code
  // (swap's return value, support flows) relies on it being a string.
  if (typeof meta.quoteRequestId !== 'string') {
    throw new BridgeEnvelopeError('Bridge quotes response is missing meta.quoteRequestId')
  }
  return { quotes: data, meta: meta as GetQuotesMeta }
}
