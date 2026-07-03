import { readMapping, parseRecordPlaintextLoose, type Client } from '@veil/core'
import { toPoolState, type PoolState } from '../../generated/shield_swap.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Parameters for {@link getPool}.
 *
 * @property poolKey Pool key as an Aleo field literal, including the `field`
 *   suffix (e.g. `"4719…024field"`). Obtain keys from the API's `/pools`
 *   endpoint or compute them from a `PoolKey` struct hash.
 * @property program Program to read from. Defaults to `DEFAULT_PROGRAM`
 *   (the live shield_swap deployment). Override to read the same mapping layout from
 *   another deployment (e.g. an older program version during a migration).
 */
export type GetPoolParameters = {
  poolKey: string
  program?: string
}

/** The decoded pool, or `null` when no pool exists under the key. */
export type GetPoolReturnType = PoolState | null

/**
 * Reads a pool's static configuration from the on-chain `pools` mapping.
 *
 * Returns the token pair, fee tier, enabled flag, and decimal scales — the
 * values that never change after `create_pool`. For live trading state
 * (price, tick, liquidity) read the `slots` mapping via `getSlot` instead.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool key to look up, and optionally the program to read from.
 * @returns The decoded pool, or `null` when no pool exists under that key.
 * @throws A transport error when the node is unreachable or rejects the request,
 *   and a decode error when the mapping value does not parse as a `PoolState` —
 *   both indicate an environment/deployment problem, not a missing pool.
 *
 * @example
 * const pool = await getPool(client, { poolKey: '4719…024field' })
 * if (pool) console.log(pool.fee, pool.token0, pool.token1)
 */
export async function getPool(client: Client, params: GetPoolParameters): Promise<GetPoolReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM
  const raw = await readMapping(client, { programId: program, mapping: 'pools', key: params.poolKey })
  // The node returns JSON null for a key that is not in the mapping.
  if (raw == null || raw === 'null') return null
  return toPoolState(parseRecordPlaintextLoose(raw, program, 'PoolState'))
}
