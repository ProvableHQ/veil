// Record parsing, encoding, and serialization utilities.
//
// These functions bridge between Aleo's plaintext record format (the string
// representation used by snarkvm) and Veil's typed RecordValue objects.

import type { Primitive, Plaintext, RecordValue, RecordFieldValue } from '../types/primitives.js'
import type { RecordDef } from '../types/abi.js'
import { parseValue, encodeValue } from './values.js'

// ── parseRecordPlaintext ──────────────────────────────────────────────

/**
 * Parses an Aleo record plaintext string into a typed RecordValue.
 *
 * Requires the RecordDef from the ABI so that each field's Aleo type
 * is embedded in the resulting RecordFieldValue (enabling toString()
 * to serialize back without needing the RecordDef again).
 *
 * @example
 * ```ts
 * const record = parseRecordPlaintext(
 *   '{ owner: aleo1abc.private, points: 1000u64.private, _nonce: 123group.public }',
 *   loyaltyCardDef,
 * )
 * // record.fields.points.value === 1000n
 * // record.fields.points.type === { kind: 'primitive', primitive: 'u64' }
 * ```
 */
export function parseRecordPlaintext(
  plaintext: string,
  recordDef: RecordDef,
  program: string,
): RecordValue {
  const rawFields = parseRawFields(plaintext)

  // Build a lookup from field name to its Plaintext type from the RecordDef
  const fieldTypeLookup = new Map(
    recordDef.fields.map((f) => [f.name, { type: f.type, mode: f.mode }]),
  )

  const fields: { [name: string]: RecordFieldValue } = {}

  for (const [key, rawValue] of Object.entries(rawFields)) {
    if (key === 'owner' || key.startsWith('_')) continue

    // Strip visibility suffix before parsing the value
    const cleaned = rawValue.replace(/\.(private|public)$/, '').trim()
    const parsed = parseValue(cleaned)
    const defInfo = fieldTypeLookup.get(key)

    fields[key] = {
      value: parsed.value,
      mode: (defInfo?.mode === 'public' ? 'public' : 'private') as 'public' | 'private',
      type: defInfo?.type ?? { kind: 'primitive', primitive: parsed.type },
    }
  }

  // Extract owner
  const ownerRaw = rawFields['owner'] ?? ''
  const owner = ownerRaw.replace(/\.private$/, '').trim()

  // Extract nonce
  const nonceRaw = rawFields['_nonce'] ?? ''
  const nonce = nonceRaw.replace(/\.public$/, '').trim()

  const recordName = recordDef.path[recordDef.path.length - 1] ?? 'unknown'
  return { owner, program, recordName, fields, nonce }
}

/**
 * Parses a record plaintext string without a RecordDef.
 * Fields will have their type inferred from the value suffix (e.g. "1000u64" → u64).
 * Less precise than parseRecordPlaintext(plaintext, recordDef, program) but works when no ABI is available.
 */
export function parseRecordPlaintextLoose(
  plaintext: string,
  program = 'unknown',
  recordName = 'unknown',
): RecordValue {
  const rawFields = parseRawFields(plaintext)

  const fields: { [name: string]: RecordFieldValue } = {}

  for (const [key, rawValue] of Object.entries(rawFields)) {
    if (key === 'owner' || key.startsWith('_')) continue

    // Detect visibility from suffix
    const isPublic = rawValue.endsWith('.public')
    const cleaned = rawValue.replace(/\.(private|public)$/, '').trim()

    const parsed = parseValue(cleaned)

    fields[key] = {
      value: parsed.value,
      mode: isPublic ? 'public' : 'private',
      type: { kind: 'primitive', primitive: parsed.type },
    }
  }

  const ownerRaw = rawFields['owner'] ?? ''
  const owner = ownerRaw.replace(/\.private$/, '').trim()

  const nonceRaw = rawFields['_nonce'] ?? ''
  const nonce = nonceRaw.replace(/\.public$/, '').trim()

  return { owner, program, recordName, fields, nonce }
}

// ── toString ───────────────────────────────────────────────────────

/**
 * Serializes a RecordValue back to Aleo record plaintext format.
 *
 * Uses the `type` field on each RecordFieldValue to determine the correct
 * Aleo type suffix. This is why RecordFieldValue carries `type: Plaintext` —
 * without it, a bigint value of 1000n could be u64, u128, field, or i64.
 *
 * @example
 * ```ts
 * const plaintext = toString(record)
 * // "{\n  owner: aleo1abc.private,\n  points: 1000u64.private,\n  _nonce: 123group.public\n}"
 * ```
 */
export function toString(record: RecordValue): string {
  const lines: string[] = []

  // Owner is always address.private
  lines.push(`  owner: ${record.owner}.private`)

  // Fields
  for (const [name, field] of Object.entries(record.fields)) {
    const primitive = extractPrimitive(field.type)
    const encoded = encodeValue(field.value as bigint | boolean | string, primitive)
    lines.push(`  ${name}: ${encoded}.${field.mode}`)
  }

  // Nonce is always group.public
  lines.push(`  _nonce: ${record.nonce}.public`)

  return `{\n${lines.join(',\n')}\n}`
}

// ── encodeInputs ──────────────────────────────────────────────────────

/**
 * Encodes native JS values into Aleo input strings using ABI type information.
 *
 * - Strings that look like record plaintext (start with '{') or are already
 *   encoded (contain type suffix) pass through unchanged.
 * - BigInts/numbers are encoded with the ABI's type suffix.
 * - Booleans become "true"/"false".
 * - RecordValue objects are serialized via toString().
 */
export function encodeInputs(
  values: (bigint | number | boolean | string | RecordValue)[],
  inputTypes: Plaintext[],
): string[] {
  return values.map((value, i) => {
    // RecordValue — serialize to plaintext
    if (typeof value === 'object' && value !== null && 'owner' in value && 'fields' in value) {
      return toString(value as RecordValue)
    }

    // Already a string — pass through (pre-encoded or record plaintext)
    if (typeof value === 'string') {
      return value
    }

    // Boolean
    if (typeof value === 'boolean') {
      return String(value)
    }

    // BigInt or number — need the type from ABI
    if (typeof value === 'bigint' || typeof value === 'number') {
      const inputType = inputTypes[i]
      if (inputType) {
        const primitive = extractPrimitive(inputType)
        return encodeValue(typeof value === 'number' ? BigInt(value) : value, primitive)
      }
      return String(value)
    }

    return String(value)
  })
}

// ── Internal helpers ──────────────────────────────────────────────────

/** Extract the Primitive string from a Plaintext type descriptor */
function extractPrimitive(pt: Plaintext): Primitive {
  if (pt.kind === 'primitive') return pt.primitive
  // For non-primitive types (struct, array, optional), fall back to 'field'
  return 'field'
}

/**
 * Parse raw fields from a record plaintext string.
 * Returns a map of field name to raw value string (with visibility suffix intact).
 */
function parseRawFields(plaintext: string): Record<string, string> {
  const fields: Record<string, string> = {}

  const inner = plaintext.replace(/^\s*\{/, '').replace(/\}\s*$/, '').trim()
  if (!inner) return fields

  const pairs = splitFields(inner)

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':')
    if (colonIdx === -1) continue

    const key = pair.slice(0, colonIdx).trim()
    const value = pair.slice(colonIdx + 1).trim()

    fields[key] = value
  }

  return fields
}

/** Split comma-separated fields, respecting nested braces */
function splitFields(input: string): string[] {
  const result: string[] = []
  let depth = 0
  let current = ''

  for (const char of input) {
    if (char === '{') depth++
    else if (char === '}') depth--

    if (char === ',' && depth === 0) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) result.push(current)
  return result
}
