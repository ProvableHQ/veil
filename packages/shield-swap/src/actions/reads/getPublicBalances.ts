import { readMapping, type Client } from '@provablehq/veil-core'

/**
 * Parameters for {@link getPublicBalances}.
 *
 * @property user Address whose public balances to read. Defaults to the
 *   client's own account address.
 * @property programs Token programs whose `balances` mapping to read — the AMM
 *   token programs from the API's token registry (`amm_token_program`), e.g.
 *   `["test_arc20_eth.aleo"]`.
 */
export type GetPublicBalancesParameters = {
  user?: string
  programs: string[]
}

/**
 * Public balances (raw base units, u128 `bigint`) keyed by token program. A
 * program the address holds nothing in maps to `0n`.
 */
export type GetPublicBalancesReturnType = Record<string, bigint>

// An ARC-20 `balances` entry: an unsigned integer literal with its width suffix.
const UNSIGNED_LITERAL = /^(\d+)u(?:8|16|32|64|128)$/

/**
 * Reads an address's public token balances from each program's on-chain
 * `balances` mapping.
 *
 * Every ARC-20 program the AMM dispatches through keys `balances` by plain
 * `address`, so the read is one mapping lookup per program with no hashing
 * and no WASM peer. This is the public counterpart to `getPrivateBalances`:
 * that sums the caller's records, this reads the mapping any address can be
 * looked up in. An absent key is a zero balance, not an error.
 *
 * Hits the network: one node request per program, issued concurrently
 * through the client's transport. Does not sign or prove.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The programs to read and, optionally, the address to read for.
 * @returns Raw base-unit balances keyed by program; absent entries read as `0n`.
 * @throws When no `user` is given and the client has no account address, or
 *   when a stored value is not an unsigned integer literal (the program's
 *   `balances` mapping is not ARC-20 shaped).
 *
 * @example
 * const balances = await getPublicBalances(client, {
 *   user: 'aleo1…',
 *   programs: ['test_arc20_eth.aleo', 'shield_swap_arc20_credits.aleo'],
 * })
 * // → { 'test_arc20_eth.aleo': 5000000000000000000n, 'shield_swap_arc20_credits.aleo': 0n }
 */
export async function getPublicBalances(
  client: Client,
  params: GetPublicBalancesParameters,
): Promise<GetPublicBalancesReturnType> {
  const user = params.user ?? (client as { account?: { address?: string } }).account?.address
  if (!user) {
    throw new Error('getPublicBalances needs a user address — pass params.user or use a client with an account')
  }

  const programs = [...new Set(params.programs)]
  const entries = await Promise.all(
    programs.map(async (program): Promise<[string, bigint]> => {
      const raw = await readMapping(client, { programId: program, mapping: 'balances', key: user })
      if (raw == null) return [program, 0n]
      const match = UNSIGNED_LITERAL.exec(raw.trim())
      if (!match) {
        throw new Error(`${program} balances[${user}] is not an unsigned integer literal: ${raw}`)
      }
      return [program, BigInt(match[1]!)]
    }),
  )
  return Object.fromEntries(entries)
}
