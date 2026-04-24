import type { Client } from '../../clients/createClient.js'

export type GetDeploymentTransactionByEditionParameters = { programId: string; edition: number }
export type GetDeploymentTransactionByEditionReturnType = string

export async function getDeploymentTransactionByEdition(
  client: Client,
  params: GetDeploymentTransactionByEditionParameters,
): Promise<GetDeploymentTransactionByEditionReturnType> {
  return client.request({
    method: 'getDeploymentTransactionByEdition',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetDeploymentTransactionByEditionReturnType>
}
