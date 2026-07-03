import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link readContract}.
 *
 * @property programId Program that owns the mapping, such as `"credits.aleo"`.
 * @property mapping Mapping name within the program, such as `"account"`.
 * @property key Mapping key as an Aleo plaintext literal — an `aleo1…` address,
 *   `"1field"`, and so on.
 */
export type ReadContractParameters = { programId: string; mapping: string; key: string }

/**
 * Raw mapping value as an Aleo literal string (e.g. `"5000000u64"`, `"true"`, or a
 * struct literal `"{owner: aleo1..., amount: 100u64}"`). Callers can use
 * `parseValue` from utils to decode into a structured `ParsedValue`.
 */
export type ReadContractReturnType = string

/**
 * Reads a public mapping value from a deployed program.
 *
 * This is the viem-shaped read for Aleo public state: mappings are a program's
 * on-chain key/value storage, and this fetches the value stored under one key.
 * The result is the raw Aleo literal string — pass it to `parseValue` to
 * decode numbers, booleans, and structs. Pure read: it hits the network but
 * does not sign or prove.
 *
 * @param client Client whose transport serves the query.
 * @param params Program, mapping, and key to read.
 * @returns The raw Aleo literal stored under the key.
 *
 * @example
 * const balance = await client.readContract({
 *   programId: 'credits.aleo',
 *   mapping: 'account',
 *   key: 'aleo1…',
 * })
 * // => '5000000u64'
 */
export async function readContract(client: Client, params: ReadContractParameters): Promise<ReadContractReturnType> {
  return client.request({
    method: 'getMappingValue',
    params: { programId: params.programId, mapping: params.mapping, key: params.key },
  }) as Promise<ReadContractReturnType>
}
