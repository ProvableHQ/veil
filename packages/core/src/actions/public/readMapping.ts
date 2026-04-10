import type { Client } from '../../clients/createClient.js'
import { readContract, type ReadContractParameters, type ReadContractReturnType } from './readContract.js'

export type ReadMappingParameters = ReadContractParameters
export type ReadMappingReturnType = ReadContractReturnType

/** Alias for readContract — reads a mapping value from a deployed program. */
export async function readMapping(client: Client, params: ReadMappingParameters): Promise<ReadMappingReturnType> {
  return readContract(client, params)
}
