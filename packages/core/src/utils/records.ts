// Record parsing, encoding, and serialization utilities.
//
// These functions bridge between Aleo's plaintext record format (the string
// representation used by snarkvm) and Veil's typed RecordValue objects.

import type { Primitive, Plaintext, RecordValue, RecordFieldValue } from '../types/primitives.js'
import type { ABI, RecordDef, FunctionInput } from '../types/abi.js'
import { parseValue, encodeValue } from './values.js'

// ── getRecordDef ──────────────────────────────────────────────────────

/**
 * Looks up a RecordDef by name from an ABI.
 *
 * @example
 * ```ts
 * const cardDef = getRecordDef(tokenAbi, 'LoyaltyCard')
 * ```
 */
export function getRecordDef(abi: ABI, recordName: string): RecordDef {
  const def = abi.records.find(
    (r) => r.path[r.path.length - 1] === recordName,
  )
  if (!def) {
    const available = abi.records.map((r) => r.path[r.path.length - 1]).join(', ')
    throw new Error(
      `Record "${recordName}" not found in program "${abi.program}". ` +
      `Available records: ${available || 'none'}`,
    )
  }
  return def
}

// ── getInputTypes ─────────────────────────────────────────────────────

/**
 * Extracts the Plaintext types for a function's inputs from an ABI.
 * Used by encodeInputs to auto-encode native values.
 *
 * @example
 * ```ts
 * const types = getInputTypes(tokenAbi, 'mint_card')
 * const encoded = encodeInputs([recipient, 1000n, 42n], types)
 * ```
 */
export function getInputTypes(abi: ABI, functionName: string): Plaintext[] {
  const fn = abi.functions.find((f) => f.name === functionName)
  if (!fn) {
    const available = abi.functions.map((f) => f.name).join(', ')
    throw new Error(
      `Function "${functionName}" not found in program "${abi.program}". ` +
      `Available functions: ${available || 'none'}`,
    )
  }
  return fn.inputs.map((input) => {
    if (input.type.kind === 'plaintext') return input.type.type
    // Record inputs are passed as pre-serialized strings; return a placeholder type
    return { kind: 'primitive' as const, primitive: 'field' as const }
  })
}

// ── parseRecordPlaintext ──────────────────────────────────────────────

/**
 * Parses an Aleo record plaintext string into a typed RecordValue.
 *
 * Accepts either a RecordDef directly or an ABI + record name (convenience).
 * Each field's Aleo type is embedded in the resulting RecordFieldValue,
 * enabling toString() to serialize back without needing the RecordDef again.
 *
 * @example
 * ```ts
 * // With ABI (recommended — no manual RecordDef lookup)
 * const record = parseRecordPlaintext(plaintext, tokenAbi, 'LoyaltyCard', 'loyalty_token.aleo')
 *
 * // With RecordDef directly
 * const record = parseRecordPlaintext(plaintext, loyaltyCardDef, 'loyalty_token.aleo')
 * ```
 */
export function parseRecordPlaintext(
  plaintext: string,
  abiOrRecordDef: ABI | RecordDef,
  recordNameOrProgram: string,
  program?: string,
): RecordValue {
  let recordDef: RecordDef
  let resolvedProgram: string

  if ('functions' in abiOrRecordDef) {
    // ABI overload: parseRecordPlaintext(plaintext, abi, recordName, program)
    const abi = abiOrRecordDef as ABI
    recordDef = getRecordDef(abi, recordNameOrProgram)
    resolvedProgram = program ?? abi.program
  } else {
    // RecordDef overload: parseRecordPlaintext(plaintext, recordDef, program)
    recordDef = abiOrRecordDef as RecordDef
    resolvedProgram = recordNameOrProgram
  }

  const rawFields = parseRawFields(plaintext)

  const fieldTypeLookup = new Map(
    recordDef.fields.map((f) => [f.name, { type: f.type, mode: f.mode }]),
  )

  const fields: { [name: string]: RecordFieldValue } = {}

  for (const [key, rawValue] of Object.entries(rawFields)) {
    if (key === 'owner' || key.startsWith('_')) continue

    const cleaned = rawValue.replace(/\.(private|public)$/, '').trim()
    const parsed = parseValue(cleaned)
    const defInfo = fieldTypeLookup.get(key)

    fields[key] = {
      value: parsed.value,
      mode: (defInfo?.mode === 'public' ? 'public' : 'private') as 'public' | 'private',
      type: defInfo?.type ?? { kind: 'primitive', primitive: parsed.type },
    }
  }

  const ownerRaw = rawFields['owner'] ?? ''
  const owner = ownerRaw.replace(/\.private$/, '').trim()

  const nonceRaw = rawFields['_nonce'] ?? ''
  const nonce = nonceRaw.replace(/\.public$/, '').trim()

  const recordName = recordDef.path[recordDef.path.length - 1] ?? 'unknown'
  return { owner, program: resolvedProgram, recordName, fields, nonce }
}

/**
 * Parses a record plaintext string without a RecordDef.
 * Fields will have their type inferred from the value suffix (e.g. "1000u64" → u64).
 * Less precise than parseRecordPlaintext with ABI but works when no ABI is available.
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

// ── toString ──────────────────────────────────────────────────────────

/**
 * Serializes a RecordValue back to Aleo record plaintext format.
 *
 * Uses the `type` field on each RecordFieldValue to determine the correct
 * Aleo type suffix. This is why RecordFieldValue carries `type: Plaintext` —
 * without it, a bigint value of 1000n could be u64, u128, field, or i64.
 *
 * Also exported as `serializeRecord` for contexts where `toString` collides
 * with the global.
 *
 * @example
 * ```ts
 * const plaintext = toString(record)
 * // "{\n  owner: aleo1abc.private,\n  points: 1000u64.private,\n  _nonce: 123group.public\n}"
 * ```
 */
export function toString(record: RecordValue): string {
  const lines: string[] = []

  lines.push(`  owner: ${record.owner}.private`)

  for (const [name, field] of Object.entries(record.fields)) {
    const primitive = extractPrimitive(field.type)
    const encoded = encodeValue(field.value as bigint | boolean | string, primitive)
    lines.push(`  ${name}: ${encoded}.${field.mode}`)
  }

  lines.push(`  _nonce: ${record.nonce}.public`)

  return `{\n${lines.join(',\n')}\n}`
}

/** Alias for toString — avoids collision with the global in standalone usage */
export const serializeRecord = toString

// ── encodeInputs ─────────────────────────────────────────────────────

/**
 * Encodes native JS values into Aleo input strings.
 *
 * Accepts either raw Plaintext types or an ABI + function name (convenience).
 *
 * - Strings pass through unchanged (pre-encoded or record plaintext)
 * - BigInts/numbers are encoded with the ABI's type suffix
 * - Booleans become "true"/"false"
 * - RecordValue objects are serialized via toString()
 *
 * @example
 * ```ts
 * // With ABI (recommended — no manual type extraction)
 * const encoded = encodeInputs([recipient, 1000n, 42n], tokenAbi, 'mint_card')
 *
 * // With raw Plaintext types
 * const encoded = encodeInputs([recipient, 1000n, 42n], inputTypes)
 * ```
 */
export function encodeInputs(
  values: (bigint | number | boolean | string | RecordValue)[],
  abiOrTypes: ABI | Plaintext[],
  functionName?: string,
): string[] {
  let inputTypes: Plaintext[]

  if (Array.isArray(abiOrTypes)) {
    inputTypes = abiOrTypes
  } else {
    if (!functionName) {
      throw new Error('functionName is required when passing an ABI to encodeInputs')
    }
    inputTypes = getInputTypes(abiOrTypes as ABI, functionName)
  }

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
