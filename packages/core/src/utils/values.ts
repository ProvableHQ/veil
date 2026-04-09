export type ParsedValue = {
  value: bigint | boolean | string
  type: string
}

const INTEGER_REGEX = /^(-?\d+)(u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|field|scalar|group)$/

export function parseValue(raw: string): ParsedValue {
  if (raw === 'true') return { value: true, type: 'boolean' }
  if (raw === 'false') return { value: false, type: 'boolean' }
  if (raw.startsWith('aleo1')) return { value: raw, type: 'address' }

  const match = raw.match(INTEGER_REGEX)
  if (match) {
    return { value: BigInt(match[1]!), type: match[2]! }
  }

  return { value: raw, type: 'string' }
}

export function encodeValue(value: bigint | boolean | string, type: string): string {
  if (type === 'boolean') return String(value)
  if (type === 'address' || type === 'string') return String(value)
  return `${value}${type}`
}

/**
 * Parses an Aleo record plaintext string into a typed key-value object.
 *
 * Input format: `{ owner: aleo1...private, card_id: 123field.private, points: 1000u64.private, ... }`
 * Strips `.private`/`.public` visibility suffixes and parses each value with `parseValue`.
 * Skips internal fields like `_nonce` and `_version`.
 *
 * @example
 * ```ts
 * const record = parseRecord('{ owner: aleo1abc.private, points: 1000u64.private }')
 * // { owner: { value: 'aleo1abc', type: 'address' }, points: { value: 1000n, type: 'u64' } }
 * ```
 */
export function parseRecord(plaintext: string): Record<string, ParsedValue> {
  const result: Record<string, ParsedValue> = {}

  // Strip outer braces
  const inner = plaintext.replace(/^\s*\{/, '').replace(/\}\s*$/, '').trim()
  if (!inner) return result

  // Split on commas, handling nested braces (for struct fields)
  const pairs = splitFields(inner)

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':')
    if (colonIdx === -1) continue

    const key = pair.slice(0, colonIdx).trim()
    const rawValue = pair.slice(colonIdx + 1).trim()

    // Skip internal fields
    if (key.startsWith('_')) continue

    // Strip visibility suffix (.private or .public) from the end
    const cleaned = rawValue.replace(/\.(private|public)\s*$/, '')

    result[key] = parseValue(cleaned)
  }

  return result
}

// ── ABI-powered encoding/parsing ──────────────────────────────────────

import type { ProgramFunction, ProgramRecord } from '../types/program.js'
import type { ParsedOutput } from '../types/abi-types.js'

/**
 * Encodes native JS values into Aleo input strings using ABI type information.
 *
 * - Strings that are already encoded (contain type suffix like "1000u64") or
 *   look like record plaintext (start with '{') are passed through unchanged.
 * - BigInts are encoded with the ABI's type suffix (e.g. 42n + 'u64' → "42u64")
 * - Booleans become "true"/"false"
 * - Strings for address types pass through as-is
 *
 * Falls back to String(value) if no ABI input definition is available for the position.
 */
export function encodeInputs(
  values: (bigint | boolean | string)[],
  inputDefs: ProgramFunction['inputs'],
): string[] {
  return values.map((value, i) => {
    // Already a string — check if it's pre-encoded or a record
    if (typeof value === 'string') {
      return value
    }

    // Boolean
    if (typeof value === 'boolean') {
      return String(value)
    }

    // BigInt — need the type from ABI
    if (typeof value === 'bigint') {
      const def = inputDefs[i]
      if (def) {
        return encodeValue(value, def.type)
      }
      // No ABI def — can't encode without type info
      return String(value)
    }

    return String(value)
  })
}

/**
 * Parses raw string outputs using ABI type information.
 *
 * For each output:
 * - If the output type matches a known record name, parses it into a structured
 *   record object with native JS field values.
 * - Otherwise, parses it as a plaintext value.
 */
export function parseOutputs(
  rawOutputs: string[],
  outputDefs: ProgramFunction['outputs'],
  records: ProgramRecord[],
): ParsedOutput[] {
  const recordNames = new Set(records.map((r) => r.name))

  return rawOutputs.map((raw, i) => {
    const def = outputDefs[i]
    const typeName = def?.type

    // Check if this output is a known record type, OR looks like a record plaintext
    // (starts with '{') — handles cross-program records from imported programs
    const isKnownRecord = typeName && recordNames.has(typeName)
    const looksLikeRecord = raw.trimStart().startsWith('{')

    if (isKnownRecord || looksLikeRecord) {
      const parsed = parseRecord(raw)
      // Convert ParsedValue map to plain values
      const data: Record<string, bigint | boolean | string> = {}
      for (const [key, pv] of Object.entries(parsed)) {
        data[key] = pv.value
      }
      return { type: 'record' as const, name: typeName ?? 'unknown', data, raw }
    }

    // Plaintext value
    return { type: 'value' as const, data: parseValue(raw) }
  })
}

/** Split comma-separated fields, respecting nested braces */
function splitFields(input: string): string[] {
  const fields: string[] = []
  let depth = 0
  let current = ''

  for (const char of input) {
    if (char === '{') depth++
    else if (char === '}') depth--

    if (char === ',' && depth === 0) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) fields.push(current)
  return fields
}
