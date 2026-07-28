// Record parsing, encoding, and serialization utilities.
//
// These functions bridge between Aleo's plaintext record format (the string
// representation used by snarkvm) and Veil's typed RecordValue objects.

import type { Primitive, Plaintext, PlaintextValue, RecordValue, RecordFieldValue, FutureValue } from '../types/primitives.js'
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

// ── parsePlaintextValue ────────────────────────────────────────────────────

/**
 * Parses an Aleo plaintext string into its runtime value.
 *
 * Covers every plaintext shape: a bare literal (`"3000u32"` → `3000n`,
 * `"true"` → `true`, an `aleo1…` address → string), a struct (`"{ a: 1u8 }"`
 * → nested `StructValue`), or an array (`"[1u8, 2u8]"` → `ArrayValue`).
 * Suited to mapping values and struct-typed transition outputs, which the
 * node returns as plaintext with self-describing literal suffixes. For
 * record plaintext — visibility-scoped entries, owner, nonce — use
 * `parseRecord` instead. Pure and local.
 *
 * Unrecognized scalars (e.g. program ids like `"registry.aleo"`) are kept
 * as raw strings rather than rejected, since not every literal form is
 * enumerable.
 *
 * @param text Aleo plaintext to parse.
 * @returns The runtime value: a literal, a struct object, or an array.
 * @throws When `text` is empty or blank.
 *
 * @example
 * parsePlaintextValue('{ token0: 3412field, fee: 3000u32, enabled: true }')
 * // { token0: 3412n, fee: 3000n, enabled: true }
 */
export function parsePlaintextValue(text: string): PlaintextValue {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Cannot parse empty plaintext')
  return parseCompositeValue(trimmed)
}

// ── parseFuture ───────────────────────────────────────────────────────

// A value is future-shaped when it is a non-array object carrying the three
// keys snarkVM's Future grammar prints: program_id, function_name, arguments.
function isFutureShaped(value: PlaintextValue): value is { [field: string]: PlaintextValue } {
  return (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'program_id' in value &&
    'function_name' in value &&
    'arguments' in value
  )
}

// Recursively converts future-shaped values to FutureValue (snake_case wire
// keys to the camelCase type); everything else passes through as plaintext.
function futureFromValue(value: PlaintextValue): FutureValue | PlaintextValue {
  if (!isFutureShaped(value)) return value
  return {
    programId: String(value['program_id']),
    function: String(value['function_name']),
    arguments: (Array.isArray(value['arguments']) ? value['arguments'] : []).map(futureFromValue),
  }
}

/**
 * Tests whether a brace-delimited string is future text — the on-chain
 * finalize handle an async transition outputs. Futures are a third value
 * kind beside plaintexts and records, and are never encrypted, so no
 * plaintext/ciphertext qualifier applies.
 *
 * Checks the top-level keys of snarkVM's Future grammar: `program_id`,
 * `function_name`, and `arguments`. Unlike `isRecordPlaintext`, this is a
 * heuristic, not a proof — all three are legal struct member names, so a
 * struct declaring exactly these members would misclassify. With an ABI in
 * hand, route by the declared output kind instead. Pure and local.
 *
 * @param text Brace-delimited text of unknown shape.
 * @returns `true` when the text carries the future grammar's top-level keys.
 */
export function isFutureText(text: string): boolean {
  const rawFields = parseRawFields(text)
  return Boolean(rawFields['program_id'] && rawFields['function_name'] && rawFields['arguments'])
}

/**
 * Parses Aleo future text into a typed FutureValue.
 *
 * Mirrors snarkVM's `Future` grammar: `program_id`, `function_name`, and an
 * `arguments` list whose elements are plaintexts or nested futures — nested
 * futures parse recursively into `FutureValue`s. Pure and local.
 *
 * @param text Future text as printed by snarkVM.
 * @returns The parsed future.
 * @throws When the text does not carry the future grammar's top-level keys.
 *
 * @example
 * const future = parseFuture(text)
 * future.programId  // 'credits.aleo'
 * future.arguments  // ['aleo1…', 100000n]
 */
export function parseFuture(text: string): FutureValue {
  const parsed = futureFromValue(parsePlaintextValue(text))
  if (typeof parsed !== 'object' || Array.isArray(parsed) || !('programId' in parsed)) {
    throw new Error('Not a future: missing program_id/function_name/arguments.')
  }
  return parsed as FutureValue
}

// ── parseRecord ───────────────────────────────────────────────────────

// Visibility suffix on a record entry leaf: `.constant`, `.public`, or
// `.private` followed by a value boundary. Record plaintext stamps the
// entry's mode on every leaf literal, including leaves nested inside
// composite entries. The `_G` variant strips every occurrence in one pass.
const ENTRY_MODE_REGEX = /\.(constant|public|private)(?=[,\s\]}]|$)/
const ENTRY_MODE_REGEX_G = /\.(constant|public|private)(?=[,\s\]}]|$)/g

/**
 * Tests whether a plaintext string is record plaintext rather than struct
 * plaintext. Every record prints an `owner` and a `_nonce` key; a struct can
 * declare a member named `owner`, but never `_nonce` — identifiers cannot
 * start with an underscore — so requiring both is decisive. Uses the same
 * criterion as `parseRecord`'s guard. Pure and local.
 *
 * @param text Brace-delimited plaintext of unknown shape.
 * @returns `true` when `parseRecord` accepts the text, `false` when it is
 *   struct or other non-record plaintext.
 */
export function isRecordPlaintext(text: string): boolean {
  const rawFields = parseRawFields(text)
  return Boolean(rawFields['owner'] && rawFields['_nonce'])
}

/**
 * Options for {@link parseRecord}.
 *
 * @property def Record definition from the program ABI. Optional — record
 *   plaintext is self-describing, so the definition only enriches entry type
 *   descriptors (exact composite types instead of best-effort inference) and
 *   supplies the record name.
 * @property program Program the record belongs to. Defaults to `"unknown"`.
 * @property recordName Record type name. Defaults to the `def` path's last
 *   segment, or `"unknown"` without a definition.
 */
export type ParseRecordOptions = {
  def?: RecordDef
  program?: string
  recordName?: string
}

/**
 * Parses an Aleo record plaintext string into a typed RecordValue.
 *
 * Mirrors snarkVM's record grammar: a visibility-scoped `owner`, data entries
 * whose mode (`constant`, `public`, or `private`) comes from their leaf
 * suffixes, a `_nonce`, and an optional `_version` (defaulting to 0). Entry
 * types are inferred from the self-describing literal suffixes; pass a
 * `RecordDef` to enrich composite entry types. The original plaintext is kept
 * on `raw`, so `serializeRecord` round-trips exactly. Pure and local.
 *
 * For plain struct, literal, or array plaintext — mapping values,
 * struct-typed outputs — use `parsePlaintextValue`: structs have no owner or
 * per-member visibility, and a struct member named `owner` is data, not
 * metadata.
 *
 * @param plaintext Record plaintext as printed by snarkVM.
 * @param options Optional record definition, program id, and record name.
 * @returns The parsed record.
 * @throws When the plaintext has no `owner` or `_nonce` key — the input is a
 *   struct or other non-record plaintext.
 *
 * @example
 * const record = parseRecord(text, { program: 'loyalty_token.aleo', recordName: 'LoyaltyCard' })
 * record.fields.points?.value // 1000n
 */
export function parseRecord(plaintext: string, options: ParseRecordOptions = {}): RecordValue {
  const rawFields = parseRawFields(plaintext)

  if (!rawFields['owner'] || !rawFields['_nonce']) {
    throw new Error(
      'Not a record plaintext: missing owner/_nonce. Parse struct or literal plaintext with parsePlaintextValue.',
    )
  }

  const typeLookup = new Map(options.def?.fields.map((f) => [f.name, f.type]) ?? [])
  const fields: { [name: string]: RecordFieldValue } = {}

  for (const [key, rawValue] of Object.entries(rawFields)) {
    // `owner` and the `_`-prefixed tags are record metadata, hoisted below.
    // Data entries cannot collide: snarkVM reserves `owner`, and identifiers
    // cannot start with an underscore.
    if (key === 'owner' || key.startsWith('_')) continue

    const mode = (ENTRY_MODE_REGEX.exec(rawValue)?.[1] ?? 'private') as RecordFieldValue['mode']
    const cleaned = rawValue.replace(ENTRY_MODE_REGEX_G, '').trim()

    if (cleaned.startsWith('[') || cleaned.startsWith('{')) {
      fields[key] = {
        value: parseCompositeValue(cleaned),
        mode,
        type: typeLookup.get(key) ?? { kind: 'primitive', primitive: 'field' },
      }
      continue
    }

    let parsed: ParsedValue
    try {
      parsed = parseValue(cleaned)
    } catch {
      // Unrecognized literal form (e.g. a program id) — keep the raw string.
      parsed = { value: cleaned, type: 'field' as Primitive }
    }

    fields[key] = {
      value: parsed.value,
      mode,
      type: typeLookup.get(key) ?? { kind: 'primitive', primitive: parsed.type },
    }
  }

  const ownerRaw = rawFields['owner'].trim()
  const ownerMode: 'public' | 'private' = ownerRaw.endsWith('.public') ? 'public' : 'private'
  const owner = ownerRaw.replace(/\.(public|private)$/, '')

  const nonce = rawFields['_nonce'].replace(/\.public$/, '').trim()

  // `_version` is optional in the grammar; snarkVM prints it as `<n>u8.public`.
  const versionMatch = /^(\d+)u8$/.exec((rawFields['_version'] ?? '').replace(/\.public$/, '').trim())
  const version = versionMatch ? Number(versionMatch[1]) : 0

  const recordName =
    options.recordName ?? options.def?.path[options.def.path.length - 1] ?? 'unknown'

  return {
    owner,
    ownerMode,
    program: options.program ?? 'unknown',
    recordName,
    fields,
    nonce,
    version,
    raw: plaintext,
  }
}

// ── toString ──────────────────────────────────────────────────────────

/**
 * Serializes a RecordValue back to Aleo record plaintext format.
 *
 * A record parsed by `parseRecord` carries its original plaintext on `raw`
 * and serializes back to it verbatim — an exact round-trip. A hand-constructed
 * value without `raw` is synthesized from its parts, using the `type` field on
 * each RecordFieldValue for the literal suffix. This is why RecordFieldValue
 * carries `type: Plaintext` — without it, a bigint value of 1000n could be
 * u64, u128, field, or i64. The synthesized path handles scalar entries only:
 * composite (struct or array) entries serialize correctly only through `raw`,
 * so a record with composite entries MUST come from `parseRecord`.
 *
 * Also exported as `serializeRecord` for contexts where `toString` collides
 * with the global.
 *
 * @example
 * ```ts
 * const plaintext = toString(record)
 * // "{\n  owner: aleo1abc.private,\n  points: 1000u64.private,\n  _nonce: 123group.public,\n  _version: 0u8.public\n}"
 * ```
 */
export function toString(record: RecordValue): string {
  if (record.raw) return record.raw

  const lines: string[] = []

  lines.push(`  owner: ${record.owner}.${record.ownerMode}`)

  for (const [name, field] of Object.entries(record.fields)) {
    const primitive = extractPrimitive(field.type)
    const encoded = encodeValue(field.value as bigint | boolean | string, primitive)
    lines.push(`  ${name}: ${encoded}.${field.mode}`)
  }

  lines.push(`  _nonce: ${record.nonce}.public`)
  lines.push(`  _version: ${record.version}u8.public`)

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
// program ids) stay as raw strings rather than being rejected.
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
