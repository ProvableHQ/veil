import type { Client } from '@provablehq/veil-core'
import { readBoolMapping } from './internal.js'

/**
 * Checks whether a fee tier is registered with the program.
 *
 * `create_pool` rejects unregistered fees; validating first turns a
 * guaranteed-revert transaction into a cheap read.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The fee in pips as a plain number (u16, e.g. `3000` for
 *   0.30%), and optionally the program to read from.
 * @returns `true` when the fee tier is registered, otherwise `false`.
 *
 * @example
 * if (!(await isFeeTierValid(client, { fee: 3000 }))) throw new Error('unsupported fee')
 */
export async function isFeeTierValid(
  client: Client,
  params: { fee: number; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'fee_tiers', `${params.fee}u16`)
}
