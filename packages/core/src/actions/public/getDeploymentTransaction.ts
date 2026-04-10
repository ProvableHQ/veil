import type { Client } from '../../clients/createClient.js'

export type GetDeploymentTransactionParameters = { program: string }
export type GetDeploymentTransactionReturnType = unknown

export async function getDeploymentTransaction(
  client: Client,
  params: GetDeploymentTransactionParameters,
): Promise<GetDeploymentTransactionReturnType> {
  return client.request({
    method: 'getDeploymentTransaction',
    params: { programId: params.program },
  })
}
