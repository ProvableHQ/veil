import type { Client } from '@provablehq/veil-core'
import { readUintMapping } from './internal.js'

/**
 * Reads the block height at which a position was frozen.
 *
 * A frozen position blocks `increase_liquidity`, `decrease_liquidity`,
 * `collect`, and `burn` until the admin unfreezes it. Absence means not
 * frozen.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The position `token_id` (field literal), and optionally the
 *   program to read from (defaults to `DEFAULT_PROGRAM`).
 * @returns The freeze block height (u32), or `null` when not frozen.
 *
 * @example
 * const frozenAt = await getFrozenPosition(client, { positionTokenId })
 */
export async function getFrozenPosition(
  client: Client,
  params: { positionTokenId: string; program?: string },
): Promise<number | null> {
  return readUintMapping(client, params.program, 'frozen_position', params.positionTokenId)
}
