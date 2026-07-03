import type { Client } from '../../clients/createClient.js'

/** Latest block height (an on-chain u32, widened to bigint for viem parity). */
export type GetBlockNumberReturnType = bigint

/**
 * Retrieves the latest block height.
 *
 * Queries the connected Aleo node, so it hits the network. The height is a
 * u32 on chain but is returned as a bigint to match viem's `getBlockNumber`;
 * convert with `Number()` before passing it to actions that take a height.
 *
 * @param client Client whose transport serves the query.
 * @returns The height of the block at the current chain tip.
 *
 * @example
 * const height = await client.getBlockNumber()
 * const block = await client.getBlock({ height: Number(height) })
 */
export async function getBlockNumber(client: Client): Promise<GetBlockNumberReturnType> {
  const height = await client.request({ method: 'getLatestHeight' })
  return BigInt(String(height))
}
