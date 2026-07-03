import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getStatePaths}.
 *
 * @property commitments Record commitments (`field` literals) to prove, fetched
 *   in one request.
 */
export type GetStatePathsParameters = { commitments: string[] }

/** Serialized state paths, one per requested commitment. */
export type GetStatePathsReturnType = string[]

/**
 * Batch state-path lookup for multiple commitments in one call.
 *
 * Reach for this over repeated `getStatePath` calls when proving several
 * records — one round trip instead of one per commitment. Queries the
 * connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Commitments to prove.
 * @returns One serialized state path per requested commitment.
 *
 * @example
 * const paths = await client.getStatePaths({ commitments: ['5031743…field', '2960987…field'] })
 */
export async function getStatePaths(
  client: Client,
  params: GetStatePathsParameters,
): Promise<GetStatePathsReturnType> {
  return client.request({
    method: 'getStatePaths',
    params: { commitments: params.commitments },
  }) as Promise<GetStatePathsReturnType>
}
