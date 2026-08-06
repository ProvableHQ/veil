import type { ApiClient } from '../api/client.js'

/**
 * A token as the registry describes it, with the fields a caller actually uses.
 *
 * @property id Token id field literal — what every action takes.
 * @property symbol Display symbol (`USDCx`), unique per network in practice but
 *   not guaranteed by the registry.
 * @property decimals Exponent for rendering; amounts everywhere else are raw
 *   base units.
 * @property ammTokenProgram The wrapper program the DEX dispatches into, when
 *   the token has one. Needed for a write's `imports`.
 * @property underlyingProgram Program holding the account's private records for
 *   this token — its own for a plain token, the wrapped asset's for a wrapper.
 */
export type TokenInfo = {
  id: string
  symbol: string
  decimals: number
  ammTokenProgram?: string
  underlyingProgram?: string
}

/** Registry rows are cached per client, since they change only on deployment. */
const cache = new WeakMap<ApiClient, Promise<TokenInfo[]>>()

type RegistryRow = {
  address: string
  symbol: string
  decimals: number
  amm_token_program?: string | null
  underlying_program?: string | null
}

/**
 * Lists the network's tokens, cached per API client.
 *
 * The registry is per network and changes only when a token is registered, so
 * repeated calls in one process reuse the first response rather than paying for
 * it again — twelve scripts asking for the same list is otherwise twelve
 * requests.
 *
 * Hits the network once per client. Requires an authenticated API client.
 *
 * @param api The DEX API client, usually `client.api`.
 * @returns Every registered token, in registry order.
 *
 * @example
 * const tokens = await listTokens(client.api)
 * console.log(tokens.map((t) => t.symbol).join(', '))
 */
export async function listTokens(api: ApiClient): Promise<TokenInfo[]> {
  const cached = cache.get(api)
  if (cached) return cached
  const pending = (async () => {
    const rows = ((await api.getTokens()).data ?? []) as RegistryRow[]
    return rows.map((row) => ({
      id: row.address,
      symbol: row.symbol,
      decimals: row.decimals,
      ...(row.amm_token_program ? { ammTokenProgram: row.amm_token_program } : {}),
      ...(row.underlying_program ? { underlyingProgram: row.underlying_program } : {}),
    }))
  })()
  cache.set(api, pending)
  // A failed lookup must not be cached, or one transient error poisons the
  // process — the next call should retry rather than replay the rejection.
  pending.catch(() => cache.delete(api))
  return pending
}

/**
 * Resolves a token by symbol or id.
 *
 * Accepts what a person types (`USDC`, case-insensitive) or what an action
 * takes (a `…field` id), so a caller does not have to know which it has. Symbols
 * are per network — testnet's registry is not mainnet's — so this always
 * resolves against the client's own network rather than a hardcoded table.
 *
 * Hits the network on first use per client, then reads the cache.
 *
 * @param api The DEX API client, usually `client.api`.
 * @param symbolOrId A symbol or a token id field literal.
 * @returns The matching token.
 * @throws When nothing matches, naming the symbols that do — a typo is the
 *   likeliest cause and the available set is the useful reply.
 *
 * @example
 * const usdc = await tokenData(client.api, 'USDCx')
 * await client.swap({ poolKey, tokenInId: usdc.id, amountIn: 5n * 10n ** BigInt(usdc.decimals) })
 */
export async function tokenData(api: ApiClient, symbolOrId: string): Promise<TokenInfo> {
  const tokens = await listTokens(api)
  const wanted = symbolOrId.trim()
  const byId = tokens.find((token) => token.id === wanted)
  if (byId) return byId
  const lower = wanted.toLowerCase()
  const bySymbol = tokens.filter((token) => token.symbol.toLowerCase() === lower)
  if (bySymbol.length === 1) return bySymbol[0]!
  if (bySymbol.length > 1) {
    throw new Error(
      `"${wanted}" matches ${bySymbol.length} tokens on this network (${bySymbol
        .map((token) => token.id)
        .join(', ')}) — pass the token id instead of the symbol.`,
    )
  }
  throw new Error(
    `No token "${wanted}" on this network. Available: ${tokens.map((token) => token.symbol).join(', ')}`,
  )
}
