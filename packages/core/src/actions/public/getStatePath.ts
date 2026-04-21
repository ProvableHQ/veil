import type { Client } from '../../clients/createClient.js'

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

export async function getStatePath(
  client: Client,
  params: GetStatePathParameters,
): Promise<GetStatePathReturnType> {
  return client.request({
    method: 'getStatePath',
    params: { commitment: params.commitment },
  }) as Promise<GetStatePathReturnType>
}
