import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'
import { sortTokenPair } from '../../utils/keys.js'

/**
 * Checks whether a token pair is paused.
 *
 * Pauses every pool over the pair regardless of fee tier. The pair is
 * order-independent — the key sorts the tokens ascending exactly as the
 * contract's `set_pair_paused` does before casting its `PairKey`. An absent
 * entry means not paused.
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The two token ids (field literals, either order), and
 *   optionally the program to read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the pair is paused, otherwise `false`.
 *
 * @example
 * const paused = await isPairPaused(client, { token0, token1 })
 */
export async function isPairPaused(
  client: Client,
  params: { token0: string; token1: string; program?: string },
): Promise<boolean> {
  const [t0, t1] = sortTokenPair(params.token0, params.token1)
  return readBoolMapping(client, params.program, 'pair_paused', `{ token0: ${t0}field, token1: ${t1}field }`)
}
