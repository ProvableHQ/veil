import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether a pool has been initialized under a pool key.
 *
 * Set by `create_pool`; a pre-flight guard that avoids building a swap or
 * liquidity transaction against a pool that does not exist.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool key (field literal with suffix), and optionally the
 *   program to read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the pool exists, otherwise `false`.
 *
 * @example
 * if (!(await isPoolInitialized(client, { poolKey }))) throw new Error('no such pool')
 */
export async function isPoolInitialized(
  client: Client,
  params: { poolKey: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'initialized_pools', params.poolKey)
}
