import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getProgramCalls}.
 *
 * @property programId Program whose latest calls to fetch, such as `"credits.aleo"`.
 */
export type GetProgramCallsParameters = { programId: string }

/** Latest calls into the program, untyped in the endpoint's wire shape. */
export type GetProgramCallsReturnType = unknown[]

/**
 * Fetches the latest calls made into a program.
 *
 * Returns the node's most-recent-calls feed as untyped elements. Reach for
 * `getProgramCallsPaginated` instead when you need typed results or to page
 * through the full call history. Queries the connected node, so it hits the
 * network.
 *
 * @param client Client whose transport serves the query.
 * @param params Program whose calls to fetch.
 * @returns The latest calls into the program.
 *
 * @example
 * const calls = await client.getProgramCalls({ programId: 'credits.aleo' })
 */
export async function getProgramCalls(
  client: Client,
  params: GetProgramCallsParameters,
): Promise<GetProgramCallsReturnType> {
  return client.request({
    method: 'getProgramCalls',
    params: { programId: params.programId },
  }) as Promise<GetProgramCallsReturnType>
}
