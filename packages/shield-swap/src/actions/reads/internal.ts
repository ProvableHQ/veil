import { readMapping, parseRecordPlaintextLoose, type Client, type RecordValue } from '@provablehq/veil-core'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Reads a struct-valued mapping entry and decodes it with a generated decoder.
 *
 * Shared by the chain-direct struct reads (`getPool`, `getSlot`,
 * `getSwapOutput`): one node request, JSON-null guard, loose plaintext parse,
 * then the width-correct generated decoder.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param program Program to read from; defaults to `DEFAULT_PROGRAM`.
 * @param mapping On-chain mapping name (e.g. `"slots"`).
 * @param key Mapping key as an Aleo literal, including its type suffix.
 * @param decode Generated struct decoder (e.g. `toSlot`).
 * @returns The decoded struct, or `null` when the key is not in the mapping.
 */
export async function readStructMapping<T>(
  client: Client,
  program: string | undefined,
  mapping: string,
  key: string,
  decode: (value: RecordValue) => T,
): Promise<T | null> {
  const programId = program ?? DEFAULT_PROGRAM
  const raw = await readMapping(client, { programId, mapping, key })
  // The node returns JSON null for a key that is not in the mapping.
  if (raw == null || raw === 'null') return null
  return decode(parseRecordPlaintextLoose(raw, programId, mapping))
}

/**
 * Reads a boolean-valued mapping entry, treating an absent key as `false`.
 *
 * The program's flag mappings (`fee_tiers`, `tick_spacings`,
 * `initialized_pools`, `used_blinded_addresses`) only ever store `true` —
 * a key is set when the thing exists and absent otherwise, so absence IS the
 * negative answer, not an error.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param program Program to read from; defaults to `DEFAULT_PROGRAM`.
 * @param mapping On-chain flag mapping name.
 * @param key Mapping key as an Aleo literal, including its type suffix.
 * @returns `true` when the key is set to true on chain, otherwise `false`.
 */
export async function readBoolMapping(
  client: Client,
  program: string | undefined,
  mapping: string,
  key: string,
): Promise<boolean> {
  const raw = await readMapping(client, { programId: program ?? DEFAULT_PROGRAM, mapping, key })
  return raw === 'true'
}

/**
 * Reads an unsigned-integer-valued mapping entry, decoding the suffixed
 * literal strictly.
 *
 * Shared by the numeric config reads (`getFeeToTickSpacing`,
 * `getFrozenPosition`, `getTokenDecimals`): one node request, JSON-null
 * guard, then a strict `<digits>u8|u16|u32` parse — a malformed response
 * fails loudly instead of yielding a silent zero.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param program Program to read from; defaults to `DEFAULT_PROGRAM`.
 * @param mapping On-chain mapping name.
 * @param key Mapping key as an Aleo literal, including its type suffix.
 * @returns The decoded value, or `null` when the key is not in the mapping.
 * @throws When the mapping value is not a suffixed unsigned literal.
 */
export async function readUintMapping(
  client: Client,
  program: string | undefined,
  mapping: string,
  key: string,
): Promise<number | null> {
  const raw = await readMapping(client, { programId: program ?? DEFAULT_PROGRAM, mapping, key })
  if (raw == null || raw === 'null') return null
  const match = /^(\d+)u(?:8|16|32)$/.exec(String(raw))
  if (!match) throw new Error(`${mapping} returned an unexpected value: ${raw}`)
  return Number(match[1])
}
