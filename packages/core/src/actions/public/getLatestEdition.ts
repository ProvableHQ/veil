import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getLatestEdition}.
 *
 * @property programId Program whose newest edition to look up, such as `"credits.aleo"`.
 */
export type GetLatestEditionParameters = { programId: string }

/** Newest edition number. 0 means the program has never been upgraded. */
export type GetLatestEditionReturnType = number

/**
 * Fetches the newest edition number of a program.
 *
 * Aleo programs are upgradeable; each upgrade increments the edition. Use it
 * to find the current edition before fetching a historical version with
 * `getProgramByEdition`. Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Program to look up.
 * @returns The latest edition number, 0 for a never-upgraded program.
 *
 * @example
 * const edition = await client.getLatestEdition({ programId: 'credits.aleo' })
 */
export async function getLatestEdition(
  client: Client,
  params: GetLatestEditionParameters,
): Promise<GetLatestEditionReturnType> {
  return client.request({
    method: 'getLatestEdition',
    params: { programId: params.programId },
  }) as Promise<GetLatestEditionReturnType>
}
