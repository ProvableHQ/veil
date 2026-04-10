import type { Client } from '../../clients/createClient.js'

export type GetMappingNamesParameters = { program: string }
export type GetMappingNamesReturnType = string[]

export async function getMappingNames(
  client: Client,
  params: GetMappingNamesParameters,
): Promise<GetMappingNamesReturnType> {
  return client.request({
    method: 'getMappingNames',
    params: { programId: params.program },
  }) as Promise<GetMappingNamesReturnType>
}
