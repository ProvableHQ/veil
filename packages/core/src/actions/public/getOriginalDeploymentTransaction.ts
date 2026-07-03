import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getOriginalDeploymentTransaction}.
 *
 * @property programId Program (e.g. `token.aleo`) whose original deployment to find.
 * @property edition Edition whose original deployment to find. Editions start at 0.
 */
export type GetOriginalDeploymentTransactionParameters = { programId: string; edition: number }
/** Transaction ID, or `null` if no original deployment tx exists (e.g., genesis programs like `credits.aleo`). */
export type GetOriginalDeploymentTransactionReturnType = string | null

/**
 * Retrieves the id of the transaction that originally deployed a program
 * edition, before any amendments.
 *
 * Queries the connected Aleo node, so it hits the network. Reach for it when
 * an edition has been amended and you need the deployment as it was first
 * published; `getAmendmentDeploymentTransaction` resolves the individual
 * amendments that followed.
 *
 * @param client Client whose transport serves the query.
 * @param params Program and edition whose original deployment to find.
 * @returns The original deployment transaction id, or `null` if none exists
 *   (e.g. genesis programs like `credits.aleo`).
 *
 * @example
 * const txId = await client.getOriginalDeploymentTransaction({
 *   programId: 'token.aleo',
 *   edition: 0,
 * })
 */
export async function getOriginalDeploymentTransaction(
  client: Client,
  params: GetOriginalDeploymentTransactionParameters,
): Promise<GetOriginalDeploymentTransactionReturnType> {
  return client.request({
    method: 'getOriginalDeploymentTransaction',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetOriginalDeploymentTransactionReturnType>
}
