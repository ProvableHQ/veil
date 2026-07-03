import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for `testClient.getMappingKeysValues`.
 *
 * @property programId Program that owns the mapping, e.g. `credits.aleo`.
 * @property mapping Mapping name within that program, e.g. `account`.
 */
export type GetMappingKeysValuesParameters = {
  programId: string
  mapping: string
}

/** Every entry in the mapping as `[key, value]` pairs of Aleo plaintext strings. */
export type GetMappingKeysValuesReturnType = [string, string][]

/**
 * Reads every key/value pair in a program mapping from a local devnode.
 *
 * Reach for this to assert on a program's full public state after a test run —
 * real network REST APIs only serve one mapping value per request, so
 * enumerating a whole mapping is a devnode-only operation. Read-only; hits
 * the devnode over the transport.
 *
 * @param client Test client whose transport points at a devnode.
 * @param params Program and mapping to enumerate.
 * @returns All entries in the mapping; an empty array when the mapping has none.
 *
 * @example
 * const entries = await testClient.getMappingKeysValues({
 *   programId: 'credits.aleo',
 *   mapping: 'account',
 * })
 */
export async function getMappingKeysValues(
  client: Client,
  params: GetMappingKeysValuesParameters,
): Promise<GetMappingKeysValuesReturnType> {
  const result = await client.request({ method: 'getMappingKeysValues', params })
  return result as GetMappingKeysValuesReturnType
}
