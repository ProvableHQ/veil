import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getDeploymentTransactionByEdition}.
 *
 * @property programId Program (e.g. `token.aleo`) whose deployment to find.
 * @property edition Edition whose deployment to find. Editions start at 0.
 */
export type GetDeploymentTransactionByEditionParameters = { programId: string; edition: number }

/** Id (`at1...`) of the transaction that deployed the edition. */
export type GetDeploymentTransactionByEditionReturnType = string

/**
 * Retrieves the id of the transaction that deployed a specific edition of a
 * program.
 *
 * Queries the connected Aleo node, so it hits the network. Reach for it when
 * tracing a program's upgrade history edition by edition;
 * `getDeploymentTransaction` covers the common case without an edition
 * number.
 *
 * @param client Client whose transport serves the query.
 * @param params Program and edition whose deployment to find.
 * @returns The id of the edition's deployment transaction.
 *
 * @example
 * const txId = await client.getDeploymentTransactionByEdition({
 *   programId: 'token.aleo',
 *   edition: 1,
 * })
 */
export async function getDeploymentTransactionByEdition(
  client: Client,
  params: GetDeploymentTransactionByEditionParameters,
): Promise<GetDeploymentTransactionByEditionReturnType> {
  return client.request({
    method: 'getDeploymentTransactionByEdition',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetDeploymentTransactionByEditionReturnType>
}
