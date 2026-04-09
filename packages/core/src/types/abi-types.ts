import type { ParsedValue } from '../utils/values.js'
import type { Program, ProgramFunction, ProgramRecord } from './program.js'

// ── Type-level mapping: Aleo types → TypeScript types ─────────────────

/** Map an Aleo type string (e.g. 'u64', 'address', 'boolean') to its TS equivalent */
export type AleoTypeToTS<T extends string> =
  T extends 'address' ? string :
  T extends 'boolean' ? boolean :
  T extends 'field' | 'group' | 'scalar' ? bigint :
  T extends `u${string}` ? bigint :
  T extends `i${string}` ? bigint :
  // Record types and unknown types fall back to string (raw record plaintext)
  string

// ── Extract function/mapping names from a Program ─────────────────────

/** Union of all function names in a Program */
export type FunctionNames<P extends Program> = P['functions'][number]['name']

/** Union of all mapping names in a Program */
export type MappingNames<P extends Program> = P['mappings'][number]['name']

// ── Parsed output types ───────────────────────────────────────────────

/** A parsed record output — fields resolved to native JS types */
export type ParsedRecordOutput = {
  type: 'record'
  name: string
  data: Record<string, bigint | boolean | string>
  raw: string
}

/** A parsed plaintext value output */
export type ParsedValueOutput = {
  type: 'value'
  data: ParsedValue
}

/** Union of possible parsed outputs */
export type ParsedOutput = ParsedRecordOutput | ParsedValueOutput

// ── Contract method types (typed vs untyped) ──────────────────────────

/** Input value — either a pre-encoded string or a native JS value for auto-encoding */
export type InputValue = bigint | boolean | string

/** Simulate params when ABI is available */
export type TypedSimulateParams = {
  inputs: InputValue[]
  imports?: Record<string, string>
}

/** Simulate return when ABI is available */
export type TypedSimulateReturn = {
  outputs: ParsedOutput[]
}

/** Write params when ABI is available */
export type TypedWriteParams = {
  inputs: InputValue[]
  fee?: bigint
  imports?: Record<string, string>
}
