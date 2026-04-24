import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'

export type GetDeploymentTransactionParameters = { programId: string }
export type GetDeploymentTransactionReturnType = Transaction

export async function getDeploymentTransaction(
  client: Client,
  params: GetDeploymentTransactionParameters,
): Promise<GetDeploymentTransactionReturnType> {
  return client.request({
    method: 'getDeploymentTransaction',
    params: { programId: params.programId },
  }) as Promise<GetDeploymentTransactionReturnType>
}
