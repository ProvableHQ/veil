import type { Client } from '../../clients/createClient.js'

export type GetAmendmentDeploymentTransactionParameters = {
  programId: string
  edition: number
  amendment: number
}
/** Transaction ID, or `null` if the amendment does not exist. */
export type GetAmendmentDeploymentTransactionReturnType = string | null

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
