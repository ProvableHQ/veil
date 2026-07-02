import { readMapping, type Client } from '@veil/core'
import { readBoolMapping } from './internal.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Checks whether a blinded address has already been consumed by a private
 * swap or claim.
 *
 * Blinded addresses are single-use: `swap_private` records each one in the
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

/**
 * Checks whether a pool has been initialized under a pool key.
 *
 * Set by `create_pool`; a pre-flight guard that avoids building a swap or
 * liquidity transaction against a pool that does not exist.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool key (field literal with suffix), and optionally the
 *   program to read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the pool exists, otherwise `false`.
 *
 * @example
 * if (!(await isPoolInitialized(client, { poolKey }))) throw new Error('no such pool')
 */
export async function isPoolInitialized(
  client: Client,
  params: { poolKey: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'initialized_pools', params.poolKey)
}

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

/**
 * Checks whether a tick spacing is registered with the program.
 *
 * Companion pre-flight to {@link isFeeTierValid} for `create_pool`.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The tick spacing as a plain number (u32), and optionally the
 *   program to read from.
 * @returns `true` when the spacing is registered, otherwise `false`.
 *
 * @example
 * await isTickSpacingValid(client, { tickSpacing: 60 })
 */
export async function isTickSpacingValid(
  client: Client,
  params: { tickSpacing: number; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'tick_spacings', `${params.tickSpacing}u32`)
}

/**
 * Reads the canonical tick spacing bound to a fee tier.
 *
 * The program pins each fee to one tick spacing (`fee_to_tick_spacing`);
 * `create_pool` callers should use this value rather than choosing their own.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The fee in pips as a plain number (u16), and optionally the
 *   program to read from.
 * @returns The bound tick spacing as a plain number (u32), or `null` when no
 *   binding exists for the fee.
 *
 * @example
 * const spacing = await getFeeToTickSpacing(client, { fee: 3000 })
 */
export async function getFeeToTickSpacing(
  client: Client,
  params: { fee: number; program?: string },
): Promise<number | null> {
  const raw = await readMapping(client, {
    programId: params.program ?? DEFAULT_PROGRAM,
    mapping: 'fee_to_tick_spacing',
    key: `${params.fee}u16`,
  })
  if (raw == null || raw === 'null') return null
  const spacing = Number(raw.replace(/u32$/, ''))
  // Fail fast on an unexpected literal shape — a NaN tick spacing passed
  // downstream would silently corrupt key encoding and pool creation.
  if (Number.isNaN(spacing)) {
    throw new Error(`fee_to_tick_spacing returned an unexpected value: ${raw}`)
  }
  return spacing
}
