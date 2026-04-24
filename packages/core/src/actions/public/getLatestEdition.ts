import type { Client } from '../../clients/createClient.js'

export type GetLatestEditionParameters = { programId: string }
export type GetLatestEditionReturnType = number

export async function getLatestEdition(
  client: Client,
  params: GetLatestEditionParameters,
): Promise<GetLatestEditionReturnType> {
  return client.request({
    method: 'getLatestEdition',
    params: { programId: params.programId },
  }) as Promise<GetLatestEditionReturnType>
}
