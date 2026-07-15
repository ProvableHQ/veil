import type { Client } from '@provablehq/veil-core'
import { readUintMapping } from './internal.js'

/**
 * Reads the canonical tick spacing bound to a fee tier.
 *
 * The program pins each fee to one tick spacing (`fee_to_tick_spacing`);
 * `create_pool` callers should use this value rather than choosing their own.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The fee in pips as a plain number (u16), and optionally the
 *   program to read from.
 * @returns The bound tick spacing as a plain number (u32), or `null` when no
 *   binding exists for the fee.
 *
 * @example
 * const spacing = await getFeeToTickSpacing(client, { fee: 3000 })
 */
export async function getFeeToTickSpacing(
  client: Client,
  params: { fee: number; program?: string },
): Promise<number | null> {
  // Strict decode — a NaN tick spacing passed downstream would silently
  // corrupt key encoding and pool creation.
  return readUintMapping(client, params.program, 'fee_to_tick_spacing', `${params.fee}u16`)
}
