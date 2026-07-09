import type { Client } from '@provablehq/veil-core'
import type { ApiClient } from '../api/client.js'
import { getPrivateBalances } from './records.js'

/**
 * Parameters for {@link getBalances}.
 *
 * @property user Address to read public balances for. Defaults to the client's
 *   own account address.
 * @property tokens Token ids (field literals) to restrict to. Defaults to
 *   every token the API lists. When given, entries are returned for exactly
 *   these tokens (including zero balances); when omitted, only tokens the user
 *   holds (non-zero total) are returned.
 */
export type GetBalancesParameters = {
  user?: string
  tokens?: string[]
}

/**
 * A single token's public, private, and combined balance.
 *
 * @property symbol Token symbol from the registry (e.g. `ETHx`).
 * @property decimals Token decimals — apply them to render a human amount.
 * @property public Public/authorized balance (raw base units) from the API.
 * @property private Private balance (raw base units) summed from the user's records.
 * @property total `public + private`.
 */
export type BalanceEntry = {
  symbol: string
  decimals: number
  public: bigint
  private: bigint
  total: bigint
}

/** Per-token balances keyed by token id (field literal). */
export type GetBalancesReturnType = Record<string, BalanceEntry>

/**
 * Tabulates public, private, and total balances per token.
 *
 * Composes the two balance views into one: the API's public/authorized
 * balances ({@link ApiClient.getPublicBalances}) and the record-derived
 * private balances ({@link getPrivateBalances}). The API's token registry
 * bridges them — public balances key by token id, private records key by
 * wrapper program — and supplies the token set to scan, so no program list
 * needs to be passed. Both sides are raw base units in each token's own decimals, so
 * `total = public + private` is meaningful per token.
 *
 * Hits the network: the token list, the public-balance read, and one record
 * scan per token program (via the client's record provider). Requires
 * `client.api` to be configured.
 *
 * @param client A Veil wallet client with a record provider (for private balances).
 * @param api The DEX API client (for the token list and public balances).
 * @param params Optional address override and token filter.
 * @returns Per-token `{ symbol, decimals, public, private, total }`, keyed by token id.
 * @throws When no `user` is given and the client has no account address.
 *
 * @example
 * const balances = await getBalances(client, api, {})
 * // → { '1223…045field': { symbol: 'ETHx', decimals: 18, public: 5n, private: 3n, total: 8n } }
 */
export async function getBalances(
  client: Client,
  api: ApiClient,
  params: GetBalancesParameters = {},
): Promise<GetBalancesReturnType> {
  const user = params.user ?? (client as { account?: { address?: string } }).account?.address
  if (!user) {
    throw new Error('getBalances needs a user address — pass params.user or use a client with an account')
  }

  // Registry: token id ↔ wrapper program, plus symbol/decimals for the result.
  const tokens = (await api.getTokens()).data
  const scoped = params.tokens ? tokens.filter((t) => params.tokens!.includes(t.address)) : tokens

  // Public balances key by token id; private records key by wrapper program.
  const publicByToken = new Map(
    (await api.getPublicBalances({ user })).data.map((b) => [b.token_id, BigInt(b.balance)]),
  )
  const programs = scoped.map((t) => t.wrapper_program).filter((p): p is string => !!p)
  const priv = await getPrivateBalances(client, { programs })

  const out: GetBalancesReturnType = {}
  for (const t of scoped) {
    const pub = publicByToken.get(t.address) ?? 0n
    const prv = t.wrapper_program ? (priv[t.wrapper_program] ?? 0n) : 0n
    // With an explicit token filter, report every requested token; otherwise
    // skip tokens the user does not hold at all.
    if (!params.tokens && pub === 0n && prv === 0n) continue
    out[t.address] = { symbol: t.symbol, decimals: t.decimals, public: pub, private: prv, total: pub + prv }
  }
  return out
}
