import type { Client } from '../../clients/createClient.js'

export type ReadContractParameters = { program: string; mapping: string; key: string }
export type ReadContractReturnType = unknown

export async function readContract(client: Client, params: ReadContractParameters): Promise<ReadContractReturnType> {
  return client.request({
    method: 'getMappingValue',
    params: { programId: params.program, mapping: params.mapping, key: params.key },
  })
}
