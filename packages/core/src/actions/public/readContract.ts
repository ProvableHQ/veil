import type { Client } from '../../clients/createClient.js'

export type ReadContractParameters = { program: string; mapping: string; key: string }

/**
 * Raw mapping value as an Aleo literal string (e.g. `"5000000u64"`, `"true"`, or a
 * struct literal `"{owner: aleo1..., amount: 100u64}"`). Callers can use
 * `parseValue` from utils to decode into a structured `ParsedValue`.
 */
export type ReadContractReturnType = string

export async function readContract(client: Client, params: ReadContractParameters): Promise<ReadContractReturnType> {
  return client.request({
    method: 'getMappingValue',
    params: { programId: params.program, mapping: params.mapping, key: params.key },
  }) as Promise<ReadContractReturnType>
}
