import type { Primitive } from '../types/primitives.js'

/**
 * A Leo literal split into its value and type, as returned by `parseValue`.
 *
 * @property value Decoded payload — `bigint` for numeric types (all widths,
 *   including field/scalar/group), `boolean` for booleans, `string` for
 *   addresses.
 * @property type Leo primitive type the literal carried.
 */
export type ParsedValue = {
  value: bigint | boolean | string
  type: Primitive
}

const INTEGER_REGEX = /^(-?\d+)(u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|field|scalar|group)$/

/**
 * Parses a Leo literal string into its value and type.
 *
 * Use it to decode plaintext values returned by the network — mapping
 * reads, transition outputs — into JavaScript values. Pure and local; the
 * inverse of `encodeValue`. All numeric types decode to `bigint` regardless
 * of width; convert to `number` yourself for u64 and smaller if needed.
 *
 * @param raw Leo literal: a suffixed integer (`'5u8'`, `'-3i64'`,
 *   `'7field'`), `'true'`/`'false'`, or an `aleo1...` address.
 * @returns The decoded value with its Leo type.
 * @throws If the string is not a recognizable Leo literal.
 *
 * @example
 * parseValue('100u64') // { value: 100n, type: 'u64' }
 * parseValue('true')   // { value: true, type: 'boolean' }
 */
export function parseValue(raw: string): ParsedValue {
  if (raw === 'true') return { value: true, type: 'boolean' }
  if (raw === 'false') return { value: false, type: 'boolean' }
  if (raw.startsWith('aleo1')) return { value: raw, type: 'address' }

  const match = raw.match(INTEGER_REGEX)
  if (match) {
    return { value: BigInt(match[1]!), type: match[2]! as Primitive }
  }

  throw new Error(`Cannot parse value: ${raw}`)
}

/**
 * Encodes a JavaScript value as a Leo literal string for use as a
 * transition input. Pure and local; the inverse of `parseValue`.
 *
 * @param value Value to encode. Numeric types take `bigint`; booleans and
 *   addresses pass through as-is.
 * @param type Leo type appended as the suffix. `boolean`, `address`,
 *   `signature`, and `identifier` values are emitted without a suffix.
 * @returns The Leo literal, ready to pass as a program input.
 *
 * @example
 * encodeValue(100n, 'u64') // '100u64'
 */
export function encodeValue(value: bigint | boolean | string, type: Primitive): string {
  if (type === 'boolean') return String(value)
  if (type === 'address' || type === 'signature' || type === 'identifier') return String(value)
  return `${value}${type}`
}
