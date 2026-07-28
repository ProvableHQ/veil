import type { Client } from '../../clients/createClient.js'
import { TransportError } from '../../errors/errors.js'

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
 * struct literal `"{owner: aleo1..., amount: 100u64}"`), or `null` when nothing is
 * stored under the key. Callers can use `parsePlaintextValue` from utils to decode
 * a non-null value into a structured `PlaintextValue`.
 */
export type ReadContractReturnType = string | null

/**
 * Reads a public mapping value from a deployed program.
 *
 * This is the viem-shaped read for Aleo public state: mappings are a program's
 * on-chain key/value storage, and this fetches the value stored under one key.
 * The result is the raw Aleo literal string — pass it to `parsePlaintextValue`
 * to decode numbers, booleans, and structs. Pure read: it hits the network but
 * does not sign or prove.
 *
 * A `null` result means the node has nothing stored under the key. The node
 * answers `null` for an unknown mapping or program as well, so a typo in
 * `mapping` or `programId` is indistinguishable from an absent key here —
 * {@link getContract} validates those names against the ABI before requesting.
 * A malformed key literal surfaces as a `TransportError` (HTTP 404 on the
 * Provable API), not as `null`.
 *
 * @param client Client whose transport serves the query.
 * @param params Program, mapping, and key to read.
 * @returns The raw Aleo literal stored under the key, or `null` when the key
 *   is not in the mapping.
 *
 * @example
 * const balance = await client.readContract({
 *   programId: 'credits.aleo',
 *   mapping: 'account',
 *   key: 'aleo1…',
 * })
 * // => '5000000u64', or null when the account holds no public credits
 */
export async function readContract(client: Client, params: ReadContractParameters): Promise<ReadContractReturnType> {
  let value: unknown
  try {
    value = await client.request({
      method: 'getMappingValue',
      params: { programId: params.programId, mapping: params.mapping, key: params.key },
    })
  } catch (error) {
    // An absent key is not an error — the node answers 200 with null — so a
    // 404 means the request itself failed. Add the read context and keep the
    // original error as the cause.
    if (error instanceof TransportError && error.status === 404) {
      throw new TransportError(
        `Reading ${params.programId}/${params.mapping} failed with HTTP 404.`,
        { cause: error, status: error.status, body: error.body },
      )
    }
    throw error
  }
  // Some backends answer the literal string "null" instead of JSON null for an
  // absent key; no Aleo value ever prints that way, so fold both into null.
  if (value == null || value === 'null') return null
  return value as string
}
