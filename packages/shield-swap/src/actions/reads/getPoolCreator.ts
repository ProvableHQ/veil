import type { Client } from '@provablehq/veil-core'
import { toPoolCreatorsMappingValue } from '../../generated/shield_swap.js'
import { readDecodedMapping } from './internal.js'

/**
 * Parameters for {@link getPoolCreator}.
 *
 * @property poolKey Pool key as an Aleo field literal, including the `field`
 *   suffix.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetPoolCreatorParameters = {
  poolKey: string
  program?: string
}

/**
 * Reads a pool's creator from the on-chain `pool_creators` mapping.
 *
 * The stored address is the immediate `create_pool` caller, written once at
 * creation — later admin or liquidity activity never changes it. Pools created
 * before the edition-1 upgrade have no entry.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool key to look up, and optionally the program to read from.
 * @returns The creator's address, or `null` when the pool does not exist or
 *   predates creator tracking.
 * @throws A transport error when the node is unreachable or rejects the request.
 *
 * @example
 * const creator = await getPoolCreator(client, { poolKey })
 */
export async function getPoolCreator(
  client: Client,
  params: GetPoolCreatorParameters,
): Promise<string | null> {
  return readDecodedMapping(client, params.program, 'pool_creators', params.poolKey, toPoolCreatorsMappingValue)
}
