import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether the whole program is paused.
 *
 * When `true`, every trading and liquidity transition reverts at finalize —
 * a pre-flight guard that turns a guaranteed revert into a cheap read. An
 * absent entry means not paused (the contract's `get_or_use` default).
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Optionally the program to read from (defaults to
 *   `DEFAULT_PROGRAM`).
 * @returns `true` when globally paused, otherwise `false`.
 *
 * @example
 * if (await isGlobalPaused(client)) throw new Error('trading is paused')
 */
export async function isGlobalPaused(client: Client, params?: { program?: string }): Promise<boolean> {
  return readBoolMapping(client, params?.program, 'global_paused', 'true')
}
