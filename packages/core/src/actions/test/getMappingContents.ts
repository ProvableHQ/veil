import type { Client } from '../../clients/createClient.js'

export type GetMappingContentsParameters = {
  programId: string
  mapping: string
}

export type GetMappingContentsReturnType = [string, string][]

export async function getMappingContents(
  client: Client,
  params: GetMappingContentsParameters,
): Promise<GetMappingContentsReturnType> {
  const result = await client.request({ method: 'getMappingContents', params })
  return result as GetMappingContentsReturnType
}
