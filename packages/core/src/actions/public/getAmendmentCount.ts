import type { Client } from '../../clients/createClient.js'

export type GetAmendmentCountParameters = { programId: string }
export type GetAmendmentCountReturnType = {
  program_id: string
  edition: number
  amendment_count: number
}

export async function getAmendmentCount(
  client: Client,
  params: GetAmendmentCountParameters,
): Promise<GetAmendmentCountReturnType> {
  return client.request({
    method: 'getAmendmentCount',
    params: { programId: params.programId },
  }) as Promise<GetAmendmentCountReturnType>
}
