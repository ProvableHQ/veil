import type { Client } from '../../clients/createClient.js'

export type GetOriginalDeploymentTransactionParameters = { programId: string; edition: number }
/** Transaction ID, or `null` if no original deployment tx exists (e.g., genesis programs like `credits.aleo`). */
export type GetOriginalDeploymentTransactionReturnType = string | null

export async function getOriginalDeploymentTransaction(
  client: Client,
  params: GetOriginalDeploymentTransactionParameters,
): Promise<GetOriginalDeploymentTransactionReturnType> {
  return client.request({
    method: 'getOriginalDeploymentTransaction',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetOriginalDeploymentTransactionReturnType>
}
