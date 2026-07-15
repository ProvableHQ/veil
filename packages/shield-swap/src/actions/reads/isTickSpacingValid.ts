import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether a tick spacing is registered with the program.
 *
 * Companion pre-flight to {@link isFeeTierValid} for `create_pool`.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The tick spacing as a plain number (u32), and optionally the
 *   program to read from.
 * @returns `true` when the spacing is registered, otherwise `false`.
 *
 * @example
 * await isTickSpacingValid(client, { tickSpacing: 60 })
 */
export async function isTickSpacingValid(
  client: Client,
  params: { tickSpacing: number; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'tick_spacings', `${params.tickSpacing}u32`)
}
