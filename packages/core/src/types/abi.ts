// ABI schema types — describe the public interface of a deployed Aleo program.
// These are the type DEFINITIONS, not runtime values.
//
// Mirrors the Leo `leo-abi-types` crate (leo/crates/abi-types/src/lib.rs).

import type { Plaintext } from './primitives.js'

// ---- Mode ----

/** Visibility of a function input, output, or record field. */
export type Mode = 'none' | 'constant' | 'private' | 'public'

// ---- Struct and Record definitions ----
// Full definitions including fields, not just references by name.

/** One named field of a struct definition. */
export type StructField = {
  name: string
  type: Plaintext
}

/** One named field of a record definition, with its on-chain visibility. */
export type RecordField = {
  name: string
  type: Plaintext
  mode: Mode
}

/**
 * A struct definition with its full field list.
 *
 * @property path Struct name path — single-element for top-level structs,
 *   multi-element for module structs (e.g. `['utils', 'Vector3']`).
 */
export type StructDef = {
  path: string[]
  fields: StructField[]
}

/**
 * A record definition with its full field list. Records always have an
 * implicit `owner: address` field in addition to the fields listed here.
 */
export type RecordDef = {
  path: string[]
  fields: RecordField[]
}

// ---- Function input/output types ----

/** Type descriptor for a function input: plaintext, a named record, or a dynamic record. */
export type FunctionInput =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'record'; path: string[]; program?: string; dynamicId?: string }
  | { kind: 'dynamicRecord' }

/**
 * Type descriptor for a function output: plaintext, a record, a dynamic
 * record, or a future handle for an on-chain finalize block.
 */
export type FunctionOutput =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'record'; path: string[]; program?: string; dynamicId?: string }
  | { kind: 'dynamicRecord' }
  | { kind: 'future' }           // handle for an on-chain finalize block
  | { kind: 'dynamicFuture' }    // dynamic dispatch finalize handle

// ---- Function ----

/**
 * A function input as declared in the ABI.
 *
 * @property name Parameter name. Present in Leo ABI JSON; "arg1", "arg2" when
 *   produced by the disassembler; undefined if unknown.
 */
export type Input = {
  name?: string
  type: FunctionInput
  mode: Mode
}

/** A function output as declared in the ABI. */
export type Output = {
  type: FunctionOutput
  mode: Mode
}

/**
 * A function entry in a program's ABI.
 *
 * @property isFinal True if the function has an on-chain finalize block.
 */
export type AbiFunction = {
  name: string
  isFinal: boolean
  inputs: Input[]
  outputs: Output[]
}

// ---- Mapping ----

/** An on-chain key-value mapping declared by the program. */
export type Mapping = {
  name: string
  key: Plaintext
  value: Plaintext
}

// ---- Storage variables ----

/** Type descriptor for a Leo storage variable: plaintext or a vector of storage types. */
export type StorageType =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'vector'; element: StorageType }

/**
 * A Leo-level storage variable. Not native to Aleo bytecode — lowered to
 * mappings with a `__` suffix convention during compilation.
 */
export type StorageVariable = {
  name: string
  type: StorageType
}

// ---- Program ----

/**
 * The full ABI of a deployed program: its structs, records, mappings, storage
 * variables, and functions. This is what gets stored in Provapipe and served
 * by the API.
 *
 * @property program Program id (e.g. "tictactoe.aleo").
 */
export type ABI = {
  program: string
  structs: StructDef[]
  records: RecordDef[]
  mappings: Mapping[]
  storageVariables: StorageVariable[]
  functions: AbiFunction[]
}
