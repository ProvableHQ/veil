import type { Client } from '../../clients/createClient.js'

export type GetStatePathsParameters = { commitments: string[] }
export type GetStatePathsReturnType = string[]

/** Batch state-path lookup for multiple commitments in one call. */
export async function getStatePaths(
  client: Client,
  params: GetStatePathsParameters,
): Promise<GetStatePathsReturnType> {
  return client.request({
    method: 'getStatePaths',
    params: { commitments: params.commitments },
  }) as Promise<GetStatePathsReturnType>
}
