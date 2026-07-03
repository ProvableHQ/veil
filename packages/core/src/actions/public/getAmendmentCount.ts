import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getAmendmentCount}.
 *
 * @property programId Program (e.g. `token.aleo`) whose amendments to count.
 */
export type GetAmendmentCountParameters = { programId: string }

/**
 * Amendment count for a program's latest edition, in API wire format.
 *
 * @property program_id Program the count applies to.
 * @property edition Edition the count was taken against.
 * @property amendment_count Number of amendments applied to that edition. 0 means the edition is unamended.
 */
export type GetAmendmentCountReturnType = {
  program_id: string
  edition: number
  amendment_count: number
}

/**
 * Retrieves the number of amendments applied to the latest edition of a
 * program.
 *
 * Queries the connected Aleo node, so it hits the network. Use it to check
 * whether a deployed program has been amended since its edition was
 * published; use `getAmendmentCountByEdition` to inspect a specific edition.
 *
 * @param client Client whose transport serves the query.
 * @param params Program to inspect.
 * @returns The program, its latest edition, and that edition's amendment count.
 *
 * @example
 * const { amendment_count } = await client.getAmendmentCount({ programId: 'token.aleo' })
 */
export async function getAmendmentCount(
  client: Client,
  params: GetAmendmentCountParameters,
): Promise<GetAmendmentCountReturnType> {
  return client.request({
    method: 'getAmendmentCount',
    params: { programId: params.programId },
  }) as Promise<GetAmendmentCountReturnType>
}
