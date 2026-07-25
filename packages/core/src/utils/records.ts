// Record parsing, encoding, and serialization utilities.
//
// These functions bridge between Aleo's plaintext record format (the string
// representation used by snarkvm) and Veil's typed RecordValue objects.

import type { Primitive, Plaintext, PlaintextValue, RecordValue, RecordFieldValue } from '../types/primitives.js'
import type { ABI, RecordDef, StructDef, FunctionInput } from '../types/abi.js'
import { parseValue, encodeValue, type ParsedValue } from './values.js'

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

// ── getStructDef ──────────────────────────────────────────────────────

/**
 * Looks up a StructDef by name from an ABI.
 *
 * @throws When the ABI declares no struct of that name.
 *
 * @example
 * const proofDef = getStructDef(swapAbi, 'MerkleProof')
 */
export function getStructDef(abi: ABI, structName: string): StructDef {
  const def = abi.structs.find((s) => s.path[s.path.length - 1] === structName)
  if (!def) {
    const available = abi.structs.map((s) => s.path[s.path.length - 1]).join(', ')
    throw new Error(
      `Struct "${structName}" not found in program "${abi.program}". ` +
      `Available structs: ${available || 'none'}`,
    )
  }
  return def
}

// ── encodePlaintextValue ──────────────────────────────────────────────

/**
 * Encodes a JavaScript value as an Aleo plaintext literal for the given
 * type descriptor — the general form of `encodeValue` covering structs,
 * arrays (including nesting, e.g. `[MerkleProof; 2]`), and optionals.
 *
 * Strings pass through unchanged at any nesting level, so pre-encoded
 * literals remain valid inputs. Structs encode from plain objects using the
 * field order of the ABI's StructDef; every declared field must be present.
 * Pure and local.
 *
 * @param value Value to encode: a literal, a plain object for a struct, an
 *   array for an array type, or a pre-encoded string.
 * @param type Aleo type descriptor the value must satisfy.
 * @param abi Supplies struct definitions. Required when `type` contains a
 *   struct reference; primitive and array-of-primitive encodings work
 *   without it.
 * @returns The Aleo plaintext literal.
 * @throws When a struct is referenced without an ABI, a struct field is
 *   missing, or an array value's length differs from the declared length.
 *
 * @example
 * encodePlaintextValue({ hi: 1n, lo: 0n }, u256Type, abi) // '{ hi: 1u128, lo: 0u128 }'
 */
export function encodePlaintextValue(value: unknown, type: Plaintext, abi?: ABI): string {
  if (typeof value === 'string') return value

  switch (type.kind) {
    case 'primitive':
      return encodeValue(
        typeof value === 'number' ? BigInt(value) : (value as bigint | boolean | string),
        type.primitive,
      )
    case 'array': {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array for ${JSON.stringify(type)}, got ${typeof value}`)
      }
      if (value.length !== type.length) {
        throw new Error(`Array length mismatch: expected ${type.length}, got ${value.length}`)
      }
      return `[${value.map((v) => encodePlaintextValue(v, type.element, abi)).join(', ')}]`
    }
    case 'struct': {
      const structName = type.path[type.path.length - 1] ?? ''
      if (!abi) {
        throw new Error(`Encoding struct "${structName}" requires an ABI with its definition`)
      }
      const def = getStructDef(abi, structName)
      const object = value as Record<string, unknown>
      const fields = def.fields.map((field) => {
        if (!(field.name in object)) {
          throw new Error(`Struct "${structName}" value is missing field "${field.name}"`)
        }
        return `${field.name}: ${encodePlaintextValue(object[field.name], field.type, abi)}`
      })
      return `{ ${fields.join(', ')} }`
    }
    case 'optional':
      return encodePlaintextValue(value, type.inner, abi)
  }
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
    const defInfo = fieldTypeLookup.get(key)
    const isComposite = cleaned.startsWith('[') || cleaned.startsWith('{')
    const value = isComposite ? parseCompositeValue(cleaned) : parseValue(cleaned).value
    const fallbackType: Plaintext = isComposite
      ? { kind: 'primitive', primitive: 'field' }
      : { kind: 'primitive', primitive: parseValue(cleaned).type }

    fields[key] = {
      value,
      mode: (defInfo?.mode === 'public' ? 'public' : 'private') as 'public' | 'private',
      type: defInfo?.type ?? fallbackType,
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

    if (cleaned.startsWith('[') || cleaned.startsWith('{')) {
      fields[key] = {
        value: parseCompositeValue(cleaned),
        mode: isPublic ? 'public' : 'private',
        type: { kind: 'primitive', primitive: 'field' },
      }
      continue
    }

    let parsed: ParsedValue
    try {
      parsed = parseValue(cleaned)
    } catch {
      // Unrecognized value format (e.g. program IDs like "loyalty_token.aleo") — store as string
      parsed = { value: cleaned, type: 'field' as Primitive }
    }

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
  values: (bigint | number | boolean | string | object | RecordValue)[],
  abiOrTypes: ABI | Plaintext[],
  functionName?: string,
): string[] {
  let inputTypes: Plaintext[]
  let abi: ABI | undefined

  if (Array.isArray(abiOrTypes)) {
    inputTypes = abiOrTypes
  } else {
    if (!functionName) {
      throw new Error('functionName is required when passing an ABI to encodeInputs')
    }
    abi = abiOrTypes as ABI
    inputTypes = getInputTypes(abi, functionName)
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

    // Everything else — literals, struct objects, arrays — encodes against
    // the declared input type when the ABI provides one.
    const inputType = inputTypes[i]
    if (inputType) {
      if (typeof value === 'bigint' || typeof value === 'number') {
        const primitive = extractPrimitive(inputType)
        return encodeValue(typeof value === 'number' ? BigInt(value) : value, primitive)
      }
      return encodePlaintextValue(value, inputType, abi)
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
    if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--

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

// Parses a plaintext value that may be composite: '[…]' arrays and '{…}'
// structs recurse; scalars defer to parseValue. Unparseable scalars (e.g.
// program ids) stay as raw strings, matching the loose-parse convention.
function parseCompositeValue(raw: string): PlaintextValue {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    const inner = trimmed.slice(1, trimmed.lastIndexOf(']'))
    return splitFields(inner).map((element) => parseCompositeValue(element))
  }
  if (trimmed.startsWith('{')) {
    const inner = trimmed.slice(1, trimmed.lastIndexOf('}'))
    const struct: { [field: string]: PlaintextValue } = {}
    for (const pair of splitFields(inner)) {
      const colon = pair.indexOf(':')
      if (colon === -1) continue
      struct[pair.slice(0, colon).trim()] = parseCompositeValue(pair.slice(colon + 1))
    }
    return struct
  }
  try {
    return parseValue(trimmed).value
  } catch {
    return trimmed
  }
}
