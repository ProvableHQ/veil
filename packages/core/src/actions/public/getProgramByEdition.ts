import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getProgramByEdition}.
 *
 * @property programId Program whose source to fetch, such as `"credits.aleo"`.
 * @property edition Edition to fetch. 0 is the original deployment; each
 *   upgrade increments the edition.
 */
export type GetProgramByEditionParameters = { programId: string; edition: number }

/** Program source text (AVM instructions) at the requested edition. */
export type GetProgramByEditionReturnType = string

/**
 * Fetches a program's source at a specific edition.
 *
 * Aleo programs are upgradeable; each upgrade deploys a new edition. Use it
 * to inspect a historical version — use `getCode` for the current source
 * and `getLatestEdition` to find the newest edition number. Queries the
 * connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Program and edition to fetch.
 * @returns The program source at that edition.
 *
 * @example
 * const original = await client.getProgramByEdition({ programId: 'credits.aleo', edition: 0 })
 */
export async function getProgramByEdition(
  client: Client,
  params: GetProgramByEditionParameters,
): Promise<GetProgramByEditionReturnType> {
  return client.request({
    method: 'getProgramByEdition',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetProgramByEditionReturnType>
}
