import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether a token is on the program's allowlist.
 *
 * `create_pool` requires both tokens allowed. An absent entry means NOT
 * allowed — allowance is opt-in, the opposite polarity of the pause flags.
 * The allowlist gates pool creation only; existing pools trade regardless.
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The token id (field literal), and optionally the program to
 *   read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the token is allowed, otherwise `false`.
 *
 * @example
 * if (!(await isTokenAllowed(client, { tokenId }))) throw new Error('token not allowed')
 */
export async function isTokenAllowed(
  client: Client,
  params: { tokenId: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'token_allowed', params.tokenId)
}
