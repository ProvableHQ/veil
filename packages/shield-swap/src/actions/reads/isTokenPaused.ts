import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether a token is individually paused.
 *
 * A paused token blocks every swap and liquidity transition that touches it.
 * An absent entry means not paused (the contract's `get_or_use` default).
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The token id (field literal), and optionally the program to
 *   read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the token is paused, otherwise `false`.
 *
 * @example
 * const paused = await isTokenPaused(client, { tokenId })
 */
export async function isTokenPaused(
  client: Client,
  params: { tokenId: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'token_paused', params.tokenId)
}
