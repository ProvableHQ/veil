import type { Client } from '@provablehq/veil-core'
import type { ApiClient } from '../api/client.js'
import { getPublicBalances } from '../actions/reads/getPublicBalances.js'
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
 * @property public Public balance (raw base units) from the AMM token
 *   program's on-chain `balances` mapping.
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
 * Composes the two chain-derived balance views into one: the AMM token
 * programs' public `balances` mappings ({@link getPublicBalances}) and the
 * record-derived private balances ({@link getPrivateBalances}). The API's
 * token registry bridges them — public balances live in each token's
 * `amm_token_program`, private records in its `underlying_program` — and
 * supplies the token set to scan, so no program list needs to be passed.
 * Both sides are raw base units in each token's own decimals, so
 * `total = public + private` is meaningful per token.
 *
 * Hits the network: the API's token list, one mapping read per token
 * program, and one record scan per underlying program (via the client's
 * record provider). Requires `client.api` to be configured; the token list
 * is a public endpoint, so no credential is needed.
 *
 * @param client A Veil wallet client with a record provider (for private balances).
 * @param api The DEX API client (for the token list).
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

  // Registry: token id ↔ programs, plus symbol/decimals for the result.
  const tokens = (await api.getTokens()).data
  const scoped = params.tokens ? tokens.filter((t) => params.tokens!.includes(t.address)) : tokens

  // Public balances live in the AMM token program the DEX dispatches through
  // (`ARC20@(token_id)::transfer_from_public`); private records live in the
  // underlying program — the spendable inventory users actually hold (a
  // plain ARC-20's own records, or a wrapped asset's underlying, e.g. credits
  // for ALEO). Both reads run concurrently.
  const publicPrograms = scoped.map((t) => t.amm_token_program).filter((p): p is string => !!p)
  const privatePrograms = scoped.map((t) => t.underlying_program).filter((p): p is string => !!p)
  const [pub, priv] = await Promise.all([
    getPublicBalances(client, { user, programs: publicPrograms }),
    getPrivateBalances(client, { programs: privatePrograms }),
  ])

  const out: GetBalancesReturnType = {}
  for (const t of scoped) {
    const publicBalance = t.amm_token_program ? (pub[t.amm_token_program] ?? 0n) : 0n
    const privateBalance = t.underlying_program ? (priv[t.underlying_program] ?? 0n) : 0n
    // With an explicit token filter, report every requested token; otherwise
    // skip tokens the user does not hold at all.
    if (!params.tokens && publicBalance === 0n && privateBalance === 0n) continue
    out[t.address] = {
      symbol: t.symbol,
      decimals: t.decimals,
      public: publicBalance,
      private: privateBalance,
      total: publicBalance + privateBalance,
    }
  }
  return out
}
