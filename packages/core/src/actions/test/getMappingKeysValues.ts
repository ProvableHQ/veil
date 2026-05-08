import type { Client } from '../../clients/createClient.js'

export type GetMappingKeysValuesParameters = {
  programId: string
  mapping: string
}

export type GetMappingKeysValuesReturnType = [string, string][]

export async function getMappingKeysValues(
  client: Client,
  params: GetMappingKeysValuesParameters,
): Promise<GetMappingKeysValuesReturnType> {
  const result = await client.request({ method: 'getMappingKeysValues', params })
  return result as GetMappingKeysValuesReturnType
}
