import type { Client } from '@provablehq/veil-core'
import { readStructMapping } from './internal.js'
import { toPosition, type Position } from '../../generated/shield_swap.js'

/**
 * Parameters for {@link getPosition}.
 *
 * @property positionTokenId The position's `token_id` field literal — the
 *   `positions` mapping key itself (no hashing). From `mint`'s return, a
 *   PositionNFT record, or `derivePositionTokenId`.
 * @property program Program to read from. Defaults to `DEFAULT_PROGRAM`.
 */
export type GetPositionParameters = {
  positionTokenId: string
  program?: string
}

/** The decoded position, or `null` when no position exists under the id. */
export type GetPositionReturnType = Position | null

/**
 * Reads a position's public state from the on-chain `positions` mapping.
 *
 * Returns the range, live liquidity, fee-growth snapshots, and the
 * `tokens_owed` balances that `decreaseLiquidity` and fee accrual settle
 * into — the read that reconciles a position after liquidity operations.
 * The mapping key is the token id itself, so no local hashing (or WASM
 * peer) is involved.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The position token id, and optionally the program to read from.
 * @returns The decoded position, or `null` when none exists under that id.
 * @throws A transport error when the node is unreachable or rejects the
 *   request, and a decode error when the mapping value does not parse as a
 *   `Position`.
 *
 * @example
 * const position = await getPosition(client, { positionTokenId })
 * if (position) console.log(position.liquidity, position.tokens_owed0)
 */
export async function getPosition(client: Client, params: GetPositionParameters): Promise<GetPositionReturnType> {
  return readStructMapping(client, params.program, 'positions', params.positionTokenId, toPosition)
}
