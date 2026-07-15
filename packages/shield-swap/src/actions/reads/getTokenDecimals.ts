import type { Client } from '@provablehq/veil-core'
import { readUintMapping } from './internal.js'

/**
 * Reads a token's registered decimal count.
 *
 * The registration feeds each pool's normalization scale; `create_pool`
 * hard-fails on an unregistered token. The value pairs with `dustScale` to
 * compute the no-dust rule for raw amounts.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The token id (field literal), and optionally the program to
 *   read from (defaults to `DEFAULT_PROGRAM`).
 * @returns The decimal count (u8), or `null` when the token is unregistered.
 *
 * @example
 * const decimals = await getTokenDecimals(client, { tokenId })
 * const scale = decimals === null ? undefined : dustScale(decimals)
 */
export async function getTokenDecimals(
  client: Client,
  params: { tokenId: string; program?: string },
): Promise<number | null> {
  return readUintMapping(client, params.program, 'token_decimals', params.tokenId)
}
