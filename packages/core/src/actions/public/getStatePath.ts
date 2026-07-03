import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getStatePath}.
 *
 * @property commitment Record commitment (a `field` literal) whose inclusion
 *   path to fetch.
 */
export type GetStatePathParameters = { commitment: string }

/**
 * The snarkVM state path — a Merkle path proving inclusion of a record commitment.
 *
 * Per snarkVM's `Serialize` impl, this comes off the wire as a JSON string (the
 * path's `Display` representation). Callers who need the structured fields
 * (global_state_root, block_path, transaction_leaf, transition_leaf, …) can parse
 * the string further themselves.
 */
export type GetStatePathReturnType = string

/**
 * Fetches the Merkle state path proving a record commitment's inclusion in the ledger.
 *
 * Spending a record requires its state path, so reach for this when building
 * execution proofs outside a node. The path verifies against the global state
 * root (see `getStateRoot`). Queries the connected node, so it hits the
 * network. Use `getStatePaths` to fetch several paths in one round trip.
 *
 * @param client Client whose transport serves the query.
 * @param params Commitment to prove.
 * @returns The serialized state path for the commitment.
 *
 * @example
 * const path = await client.getStatePath({ commitment: '5031743…field' })
 */
export async function getStatePath(
  client: Client,
  params: GetStatePathParameters,
): Promise<GetStatePathReturnType> {
  return client.request({
    method: 'getStatePath',
    params: { commitment: params.commitment },
  }) as Promise<GetStatePathReturnType>
}
