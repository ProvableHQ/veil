import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether permissionless pool creation is open.
 *
 * When `false`, only the admin can `create_pool`. An absent entry means
 * closed (the contract's `get_or_use` default, also set by the constructor).
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Optionally the program to read from (defaults to
 *   `DEFAULT_PROGRAM`).
 * @returns `true` when anyone may create pools, otherwise `false`.
 *
 * @example
 * const open = await isPoolCreationOpen(client)
 */
export async function isPoolCreationOpen(client: Client, params?: { program?: string }): Promise<boolean> {
  return readBoolMapping(client, params?.program, 'pool_creation_is_open', 'true')
}
