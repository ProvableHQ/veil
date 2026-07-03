// Parses Leo ABI JSON primitive and plaintext type descriptors into
// veil's internal TypeScript types.
//
// Leo uses Rust's default enum serialization which produces capitalized,
// nested JSON. This module converts that into veil's clean discriminated unions.
//
// Example:
//   Leo JSON:  { "Primitive": { "UInt": "U8" } }
//   Veil type: { kind: 'primitive', primitive: 'u8' }

import type { Primitive, Plaintext } from '../types/primitives.js'

// ---- Primitive parsing ----
// Leo JSON primitives look like:
//   "Address"               → 'address'
//   "Boolean"               → 'boolean'
//   { "UInt": "U8" }        → 'u8'
//   { "Int": "I64" }        → 'i64'

function parseUInt(raw: string): Primitive {
  const map: Record<string, Primitive> = {
    U8: 'u8', U16: 'u16', U32: 'u32', U64: 'u64', U128: 'u128',
  }
  const result = map[raw]
  if (!result) throw new Error(`Unknown UInt variant: ${raw}`)
  return result
}

function parseInt_(raw: string): Primitive {
  const map: Record<string, Primitive> = {
    I8: 'i8', I16: 'i16', I32: 'i32', I64: 'i64', I128: 'i128',
  }
  const result = map[raw]
  if (!result) throw new Error(`Unknown Int variant: ${raw}`)
  return result
}

/**
 * Parses a Leo ABI JSON primitive descriptor into Veil's lowercase
 * `Primitive` name.
 *
 * Reached through `parseAbi`; call it directly only when handling raw Leo
 * ABI fragments by hand. Pure and local.
 *
 * @param raw Leo JSON primitive: a capitalized string variant such as
 *   `"Address"`, or a `{ UInt }` / `{ Int }` object variant.
 * @returns The primitive name, e.g. `'u8'` or `'address'`.
 * @throws If the variant is not a known Leo primitive.
 *
 * @example
 * parsePrimitive({ UInt: 'U64' }) // 'u64'
 */
export function parsePrimitive(raw: unknown): Primitive {
  // Simple string variants: "Address", "Boolean", "Field", etc.
  if (typeof raw === 'string') {
    const map: Record<string, Primitive> = {
      Address: 'address',
      Boolean: 'boolean',
      Field: 'field',
      Group: 'group',
      Identifier: 'identifier',
      Scalar: 'scalar',
      Signature: 'signature',
    }
    const result = map[raw]
    if (!result) throw new Error(`Unknown Primitive variant: ${raw}`)
    return result
  }

  // Object variants: { "UInt": "U8" } or { "Int": "I64" }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    if ('UInt' in obj) return parseUInt(obj.UInt as string)
    if ('Int' in obj) return parseInt_(obj.Int as string)
  }

  throw new Error(`Invalid Primitive: ${JSON.stringify(raw)}`)
}

// ---- Plaintext parsing ----
// Leo JSON plaintext looks like:
//   { "Primitive": { "UInt": "U8" } }
//   { "Struct": { "path": ["Row"], "program": "tictactoe.aleo" } }
//   { "Array": { "element": { "Primitive": "Boolean" }, "length": 4 } }
//   { "Optional": { "Primitive": "Boolean" } }

/**
 * Parses a Leo ABI JSON plaintext type descriptor into Veil's `Plaintext`
 * discriminated union. Handles primitives, structs, arrays, and optionals,
 * recursing into nested element types. Pure and local.
 *
 * @param raw Leo JSON plaintext, e.g. `{ Primitive: { UInt: 'U8' } }` or
 *   `{ Array: { element: ..., length: 4 } }`.
 * @returns The type as a `{ kind: ... }` union member.
 * @throws If the variant is not a known Leo plaintext shape.
 *
 * @example
 * parsePlaintext({ Primitive: 'Boolean' })
 * // { kind: 'primitive', primitive: 'boolean' }
 */
export function parsePlaintext(raw: unknown): Plaintext {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid Plaintext: ${JSON.stringify(raw)}`)
  }

  const obj = raw as Record<string, unknown>

  if ('Primitive' in obj) {
    return { kind: 'primitive', primitive: parsePrimitive(obj.Primitive) }
  }

  if ('Struct' in obj) {
    const s = obj.Struct as { path: string[]; program?: string }
    return { kind: 'struct', path: s.path, program: s.program }
  }

  if ('Array' in obj) {
    const a = obj.Array as { element: unknown; length: number }
    return { kind: 'array', element: parsePlaintext(a.element), length: a.length }
  }

  if ('Optional' in obj) {
    return { kind: 'optional', inner: parsePlaintext(obj.Optional) }
  }

  throw new Error(`Unknown Plaintext variant: ${JSON.stringify(raw)}`)
}
