import type { Client } from '../../clients/createClient.js'

export type GetAmendmentCountByEditionParameters = { programId: string; edition: number }
export type GetAmendmentCountByEditionReturnType = {
  program_id: string
  edition: number
  amendment_count: number
}

export async function getAmendmentCountByEdition(
  client: Client,
  params: GetAmendmentCountByEditionParameters,
): Promise<GetAmendmentCountByEditionReturnType> {
  return client.request({
    method: 'getAmendmentCountByEdition',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetAmendmentCountByEditionReturnType>
}
