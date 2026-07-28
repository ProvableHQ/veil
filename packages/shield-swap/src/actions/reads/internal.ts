import { readMapping, type Client } from '@provablehq/veil-core'
import { SHIELD_SWAP } from '../../constants.js'

/**
 * Reads a mapping entry and decodes it with the mapping's generated value
 * decoder.
 *
 * Shared by every chain-direct read: one node request, absent-key guard, then
 * the generated width-correct decoder (e.g. `toPoolsMappingValue`). Absence is
 * not an error — a key that is not in the mapping resolves to `null`.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param program Program to read from; defaults to `shield_swap.aleo`.
 * @param mapping On-chain mapping name (e.g. `"slots"`).
 * @param key Mapping key as an Aleo literal, including its type suffix.
 * @param decode Generated mapping-value decoder (e.g. `toSlotsMappingValue`).
 * @returns The decoded value, or `null` when the key is not in the mapping.
 * @throws When the raw value does not parse as the mapping's declared type —
 *   the deployment does not match the generated ABI.
 */
export async function readDecodedMapping<T>(
  client: Client,
  program: string | undefined,
  mapping: string,
  key: string,
  decode: (raw: string) => T,
): Promise<T | null> {
  const raw = await readMapping(client, { programId: program ?? SHIELD_SWAP, mapping, key })
  return raw == null ? null : decode(raw)
}

/**
 * Reads a flag mapping entry, treating an absent key as `false`.
 *
 * The program's flag mappings (`fee_tiers`, `tick_spacings`,
 * `initialized_pools`, `used_blinded_addresses`, the pause switches) only
 * ever store `true` — a key is set when the thing exists and absent
 * otherwise, so absence IS the negative answer, not an error.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param program Program to read from; defaults to `shield_swap.aleo`.
 * @param mapping On-chain flag mapping name.
 * @param key Mapping key as an Aleo literal, including its type suffix.
 * @param decode Generated mapping-value decoder (e.g. `toFeeTiersMappingValue`).
 * @returns `true` when the key is set to true on chain, otherwise `false`.
 */
export async function readFlagMapping(
  client: Client,
  program: string | undefined,
  mapping: string,
  key: string,
  decode: (raw: string) => boolean,
): Promise<boolean> {
  return (await readDecodedMapping(client, program, mapping, key, decode)) ?? false
}
