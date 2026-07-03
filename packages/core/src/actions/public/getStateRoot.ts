import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getStateRoot}.
 *
 * @property height Optional block height to fetch the root at. Defaults to the
 *   latest block.
 */
export type GetStateRootParameters = { height?: number }

/** The global state root, as an `sr1…` string. */
export type GetStateRootReturnType = string

/**
 * Fetches the ledger's global state root, at a given height or the latest block.
 *
 * The state root commits to the entire ledger; the state paths returned by
 * `getStatePath` verify against it. Reach for this when checking inclusion
 * proofs or anchoring off-chain data to a ledger state. Queries the connected
 * node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Optional height selector. When omitted, returns the latest root.
 * @returns The state root at the requested height.
 *
 * @example
 * const root = await client.getStateRoot()
 * const historical = await client.getStateRoot({ height: 100_000 })
 */
export async function getStateRoot(
  client: Client,
  params: GetStateRootParameters = {},
): Promise<GetStateRootReturnType> {
  return client.request({
    method: 'getStateRoot',
    params: { height: params.height },
  }) as Promise<GetStateRootReturnType>
}
