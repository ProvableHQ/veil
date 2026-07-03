import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getBalance}.
 *
 * @property address Account (`aleo1...`) whose public balance to read.
 */
export type GetBalanceParameters = { address: string }

/** Public balance in microcredits (an on-chain u64, widened to bigint). */
export type GetBalanceReturnType = bigint

/**
 * Retrieves the public credits balance of an account.
 *
 * Reads the `credits.aleo` `account` mapping on the connected Aleo node, so it
 * hits the network. This covers only the public balance — credits held in
 * private records are not included and MUST be summed from the owner's
 * unspent records instead.
 *
 * @param client Client whose transport serves the query.
 * @param params Account to read.
 * @returns The public balance in microcredits, parsed from the on-chain u64.
 *
 * @example
 * const balance = await client.getBalance({ address: 'aleo1...' })
 */
export async function getBalance(client: Client, params: GetBalanceParameters): Promise<GetBalanceReturnType> {
  const value = await client.request({ method: 'getBalance', params: { address: params.address } })
  // Aleo REST API returns microcredits as a string with u64 suffix (e.g. "1000000u64")
  const raw = String(value)
  const stripped = raw.replace(/u\d+$/, '')
  return BigInt(stripped)
}
