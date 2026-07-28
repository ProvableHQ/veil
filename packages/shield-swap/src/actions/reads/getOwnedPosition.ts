import type { Client } from '@provablehq/veil-core'
import { SHIELD_SWAP } from '../../constants.js'
import { listPositionNFTs } from '../../utils/records.js'
import { getSlot } from './getSlot.js'
import { enrichOwnedPosition, type OwnedPosition } from './getOwnedPositions.js'

/**
 * Parameters for {@link getOwnedPosition}.
 *
 * @property positionTokenId The position's `token_id` field literal — from
 *   `mint`'s return, a prior `getOwnedPositions` listing, or
 *   `derivePositionTokenId`.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetOwnedPositionParameters = {
  positionTokenId: string
  program?: string
}

/** The owned position, or `null` when the account owns no record with the id. */
export type GetOwnedPositionReturnType = OwnedPosition | null

/**
 * Resolves one of the account's liquidity positions by its token id.
 *
 * The single-position counterpart to `getOwnedPositions`: scans the
 * account's PositionNFT records for the id, then joins the match with its
 * public chain state and derived values. Requires the id explicitly — there
 * is no pool-based auto-selection, so multiple positions in one pool cannot
 * be confused. Contrast with `getPosition`, which reads the public mapping
 * for ANY token id on a transport-only client but carries no record,
 * amounts, or fees.
 *
 * Hits the network: one record scan plus up to five mapping reads. Requires
 * record access — a connected wallet, or a local account with a record
 * provider — and the optional `@provablehq/sdk` peer for tick-key
 * derivation.
 *
 * @param client A Veil wallet client with record access.
 * @param params The position token id, and optionally the program to read from.
 * @returns The joined view, or `null` when the account owns no record with
 *   that id — the position may still exist under another owner.
 * @throws When the client has no record access, when tick-key derivation
 *   needs the missing `@provablehq/sdk` peer, and on transport errors.
 *
 * @example
 * const position = await getOwnedPosition(client, { positionTokenId })
 * if (position?.state) console.log(position.state.uncollectedFees0)
 */
export async function getOwnedPosition(
  client: Client,
  params: GetOwnedPositionParameters,
): Promise<GetOwnedPositionReturnType> {
  const program = params.program ?? SHIELD_SWAP
  const [nft] = await listPositionNFTs(client, { program, tokenId: params.positionTokenId })
  if (!nft) return null
  return enrichOwnedPosition(client, { nft, program, slot: getSlot(client, { poolKey: nft.poolKey, program }) })
}
