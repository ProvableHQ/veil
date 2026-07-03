import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getAmendmentDeploymentTransaction}.
 *
 * @property programId Program (e.g. `token.aleo`) whose amendment to look up.
 * @property edition Edition the amendment was applied to. Editions start at 0.
 * @property amendment Amendment index within the edition, starting at 0.
 */
export type GetAmendmentDeploymentTransactionParameters = {
  programId: string
  edition: number
  amendment: number
}
/** Transaction ID, or `null` if the amendment does not exist. */
export type GetAmendmentDeploymentTransactionReturnType = string | null

/**
 * Retrieves the id of the transaction that applied a specific amendment to a
 * program edition.
 *
 * Queries the connected Aleo node, so it hits the network. Reach for it when
 * tracing how a program changed: `getAmendmentCountByEdition` tells you how
 * many amendments exist, and this resolves each one to its transaction.
 *
 * @param client Client whose transport serves the query.
 * @param params Program, edition, and amendment index to resolve.
 * @returns The transaction id (`at1...`), or `null` if no such amendment exists.
 *
 * @example
 * const txId = await client.getAmendmentDeploymentTransaction({
 *   programId: 'token.aleo',
 *   edition: 0,
 *   amendment: 0,
 * })
 */
export async function getAmendmentDeploymentTransaction(
  client: Client,
  params: GetAmendmentDeploymentTransactionParameters,
): Promise<GetAmendmentDeploymentTransactionReturnType> {
  return client.request({
    method: 'getAmendmentDeploymentTransaction',
    params: {
      programId: params.programId,
      edition: params.edition,
      amendment: params.amendment,
    },
  }) as Promise<GetAmendmentDeploymentTransactionReturnType>
}
