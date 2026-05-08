// ABI schema types — describe the public interface of a deployed Aleo program.
// These are the type DEFINITIONS, not runtime values.
//
// Mirrors the Leo `leo-abi-types` crate (leo/crates/abi-types/src/lib.rs).

import type { Plaintext } from './primitives.js'

// ---- Mode ----
// Visibility of a function input, output, or record field.

export type Mode = 'none' | 'constant' | 'private' | 'public'

// ---- Struct and Record definitions ----
// Full definitions including fields, not just references by name.

export type StructField = {
  name: string
  type: Plaintext
}

export type RecordField = {
  name: string
  type: Plaintext
  mode: Mode
}

// A struct definition. path is single-element for top-level structs,
// multi-element for module structs e.g. ['utils', 'Vector3'].
export type StructDef = {
  path: string[]
  fields: StructField[]
}

// A record definition. Records always have an implicit `owner: address` field.
export type RecordDef = {
  path: string[]
  fields: RecordField[]
}

// ---- Function input/output types ----
// Functions can accept plaintext, record, or dynamic record inputs.
// Outputs can be plaintext, record, dynamic record, or a finalize handle.

export type FunctionInput =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'record'; path: string[]; program?: string; dynamicId?: string }
  | { kind: 'dynamicRecord' }

export type FunctionOutput =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'record'; path: string[]; program?: string; dynamicId?: string }
  | { kind: 'dynamicRecord' }
  | { kind: 'future' }           // handle for an on-chain finalize block
  | { kind: 'dynamicFuture' }    // dynamic dispatch finalize handle

// ---- Function ----

export type Input = {
  name?: string  // present from Leo ABI JSON; "arg1", "arg2" from disassembler; undefined if unknown
  type: FunctionInput
  mode: Mode
}

export type Output = {
  type: FunctionOutput
  mode: Mode
}

export type AbiFunction = {
  name: string
  isFinal: boolean              // true if the function has a finalize block
  inputs: Input[]
  outputs: Output[]
}

// ---- Mapping ----
// On-chain key-value storage.

export type Mapping = {
  name: string
  key: Plaintext
  value: Plaintext
}

// ---- Storage variables ----
// Leo-level storage (not native to Aleo bytecode — lowered to mappings with
// a `__` suffix convention during compilation).

export type StorageType =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'vector'; element: StorageType }

export type StorageVariable = {
  name: string
  type: StorageType
}

// ---- Program ----
// The full ABI for a deployed program. This is what gets stored in Provapipe
// and served by the API.

export type ABI = {
  program: string               // e.g. "tictactoe.aleo"
  structs: StructDef[]
  records: RecordDef[]
  mappings: Mapping[]
  storageVariables: StorageVariable[]
  functions: AbiFunction[]
}
