import type { Client } from '../../clients/createClient.js'
import { readContract, type ReadContractParameters, type ReadContractReturnType } from './readContract.js'

/** Alias of {@link ReadContractParameters}. */
export type ReadMappingParameters = ReadContractParameters

/** Alias of {@link ReadContractReturnType} — the raw Aleo literal stored under the key. */
export type ReadMappingReturnType = ReadContractReturnType

/**
 * Alias for readContract — reads a mapping value from a deployed program.
 *
 * Same behavior under the Aleo-native name: Aleo docs call public key/value
 * state a mapping, viem calls the read a contract read. Hits the network; does
 * not sign or prove.
 *
 * @param client Client whose transport serves the query.
 * @param params Program, mapping, and key to read.
 * @returns The raw Aleo literal stored under the key; decode with `parseValue`.
 *
 * @example
 * const balance = await client.readMapping({
 *   programId: 'credits.aleo',
 *   mapping: 'account',
 *   key: 'aleo1…',
 * })
 */
export async function readMapping(client: Client, params: ReadMappingParameters): Promise<ReadMappingReturnType> {
  return readContract(client, params)
}
