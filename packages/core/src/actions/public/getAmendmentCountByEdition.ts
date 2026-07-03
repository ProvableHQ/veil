import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getAmendmentCountByEdition}.
 *
 * @property programId Program (e.g. `token.aleo`) whose amendments to count.
 * @property edition Edition to count amendments for. Editions start at 0.
 */
export type GetAmendmentCountByEditionParameters = { programId: string; edition: number }

/**
 * Amendment count for a specific program edition, in API wire format.
 *
 * @property program_id Program the count applies to.
 * @property edition Edition the count was taken against.
 * @property amendment_count Number of amendments applied to that edition. 0 means the edition is unamended.
 */
export type GetAmendmentCountByEditionReturnType = {
  program_id: string
  edition: number
  amendment_count: number
}

/**
 * Retrieves the number of amendments applied to a specific edition of a
 * program.
 *
 * Queries the connected Aleo node, so it hits the network. Applies when
 * auditing an older edition; `getAmendmentCount` covers the latest edition
 * without needing an edition number.
 *
 * @param client Client whose transport serves the query.
 * @param params Program and edition to inspect.
 * @returns The program, the requested edition, and that edition's amendment count.
 *
 * @example
 * const { amendment_count } = await client.getAmendmentCountByEdition({
 *   programId: 'token.aleo',
 *   edition: 0,
 * })
 */
export async function getAmendmentCountByEdition(
  client: Client,
  params: GetAmendmentCountByEditionParameters,
): Promise<GetAmendmentCountByEditionReturnType> {
  return client.request({
    method: 'getAmendmentCountByEdition',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetAmendmentCountByEditionReturnType>
}
