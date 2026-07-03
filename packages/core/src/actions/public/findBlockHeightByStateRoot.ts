import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link findBlockHeightByStateRoot}.
 *
 * @property stateRoot State root (`sr1...`) whose block height to locate.
 */
export type FindBlockHeightByStateRootParameters = { stateRoot: string }

/** Height (u32) of the block that produced the state root. */
export type FindBlockHeightByStateRootReturnType = number

/**
 * Finds the height of the block that produced a state root.
 *
 * Queries the connected Aleo node, so it hits the network. Use it while
 * verifying a state path or proof anchored to a state root, to locate the
 * block it came from.
 *
 * @param client Client whose transport serves the query.
 * @param params State root to locate.
 * @returns The block height (u32) at which the state root was committed.
 *
 * @example
 * const height = await client.findBlockHeightByStateRoot({ stateRoot: 'sr1...' })
 */
export async function findBlockHeightByStateRoot(
  client: Client,
  params: FindBlockHeightByStateRootParameters,
): Promise<FindBlockHeightByStateRootReturnType> {
  return client.request({
    method: 'findBlockHeightByStateRoot',
    params: { stateRoot: params.stateRoot },
  }) as Promise<FindBlockHeightByStateRootReturnType>
}
