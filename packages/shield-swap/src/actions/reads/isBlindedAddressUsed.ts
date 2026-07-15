import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether a blinded address has already been consumed by a private
 * swap or claim.
 *
 * Blinded addresses are single-use: `swap` records each one in the
 * `used_blinded_addresses` mapping. The blinded-identity counter scan calls
 * this to find the first unused counter. Absence means unused.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The blinded address (`aleo1…`) to check, and optionally the
 *   program to read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the address has been used, otherwise `false`.
 *
 * @example
 * if (!(await isBlindedAddressUsed(client, { address: blinded }))) useIt(blinded)
 */
export async function isBlindedAddressUsed(
  client: Client,
  params: { address: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'used_blinded_addresses', params.address)
}
