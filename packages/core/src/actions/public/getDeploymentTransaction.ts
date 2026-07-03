import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'

/**
 * Parameters for {@link getDeploymentTransaction}.
 *
 * @property programId Program (e.g. `token.aleo`) whose deployment to find.
 */
export type GetDeploymentTransactionParameters = { programId: string }

/** The transaction that deployed the program. */
export type GetDeploymentTransactionReturnType = Transaction

/**
 * Retrieves the transaction that deployed a program.
 *
 * Queries the connected Aleo node, so it hits the network. Use it to find
 * who deployed a program and when; for a specific edition's deployment
 * use `getDeploymentTransactionByEdition`.
 *
 * @param client Client whose transport serves the query.
 * @param params Program whose deployment to find.
 * @returns The deployment transaction for the program.
 *
 * @example
 * const tx = await client.getDeploymentTransaction({ programId: 'token.aleo' })
 */
export async function getDeploymentTransaction(
  client: Client,
  params: GetDeploymentTransactionParameters,
): Promise<GetDeploymentTransactionReturnType> {
  return client.request({
    method: 'getDeploymentTransaction',
    params: { programId: params.programId },
  }) as Promise<GetDeploymentTransactionReturnType>
}
