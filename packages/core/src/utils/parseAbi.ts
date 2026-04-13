// Parses the Leo ABI JSON format (Rust serde default serialization) into
// veil's internal TypeScript ABI types.
//
// Example input (from `leo abi <program.aleo>`):
//   {
//     "program": "tictactoe.aleo",
//     "functions": [
//       {
//         "name": "move",
//         "is_final": false,
//         "inputs": [{ "name": "player", "ty": { "Plaintext": { "Primitive": "Address" } }, "mode": "Private" }],
//         "outputs": [{ "ty": { "Record": { "path": ["Board"], "program": "tictactoe.aleo" } }, "mode": "Private" }]
//       }
//     ],
//     ...
//   }

import type {
  ABI,
  AbiFunction,
  Input,
  Output,
  FunctionInput,
  FunctionOutput,
  Mode,
  StructDef,
  RecordDef,
  StructField,
  RecordField,
  Mapping,
  StorageVariable,
  StorageType,
} from '../types/abi.js'
import { parsePlaintext } from './parsePrimitives.js'

// ---- Mode ----

function parseMode(raw: unknown): Mode {
  const map: Record<string, Mode> = {
    None: 'none',
    Constant: 'constant',
    Private: 'private',
    Public: 'public',
  }
  if (typeof raw !== 'string') throw new Error(`Invalid Mode: ${JSON.stringify(raw)}`)
  const result = map[raw]
  if (!result) throw new Error(`Unknown Mode variant: ${raw}`)
  return result
}

// ---- FunctionInput ----
// Leo JSON:
//   { "Plaintext": <Plaintext> }
//   { "Record": { "path": [...], "program": "..." } }
//   "DynamicRecord"

function parseFunctionInput(raw: unknown): FunctionInput {
  if (raw === 'DynamicRecord') return { kind: 'dynamicRecord' }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>

    if ('Plaintext' in obj) {
      return { kind: 'plaintext', type: parsePlaintext(obj.Plaintext) }
    }

    if ('Record' in obj) {
      const r = obj.Record as { path: string[]; program?: string }
      return { kind: 'record', path: r.path, program: r.program }
    }
  }

  throw new Error(`Unknown FunctionInput variant: ${JSON.stringify(raw)}`)
}

// ---- FunctionOutput ----
// Same as FunctionInput plus:
//   "Final"

function parseFunctionOutput(raw: unknown): FunctionOutput {
  if (raw === 'DynamicRecord') return { kind: 'dynamicRecord' }
  if (raw === 'Final') return { kind: 'final' }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>

    if ('Plaintext' in obj) {
      return { kind: 'plaintext', type: parsePlaintext(obj.Plaintext) }
    }

    if ('Record' in obj) {
      const r = obj.Record as { path: string[]; program?: string }
      return { kind: 'record', path: r.path, program: r.program }
    }
  }

  throw new Error(`Unknown FunctionOutput variant: ${JSON.stringify(raw)}`)
}

// ---- Input / Output ----

function parseInput(raw: unknown): Input {
  const obj = raw as { name?: string; ty: unknown; mode: unknown }
  return {
    name: obj.name,
    type: parseFunctionInput(obj.ty),
    mode: parseMode(obj.mode),
  }
}

function parseOutput(raw: unknown): Output {
  const obj = raw as { ty: unknown; mode: unknown }
  return {
    type: parseFunctionOutput(obj.ty),
    mode: parseMode(obj.mode),
  }
}

// ---- Function ----

function parseFunction(raw: unknown): AbiFunction {
  const obj = raw as { name: string; is_final: boolean; inputs: unknown[]; outputs: unknown[] }
  return {
    name: obj.name,
    isFinal: obj.is_final,
    inputs: obj.inputs.map(parseInput),
    outputs: obj.outputs.map(parseOutput),
  }
}

// ---- Struct / Record ----

function parseStructField(raw: unknown): StructField {
  const obj = raw as { name: string; ty: unknown }
  return { name: obj.name, type: parsePlaintext(obj.ty) }
}

function parseRecordField(raw: unknown): RecordField {
  const obj = raw as { name: string; ty: unknown; mode: unknown }
  return { name: obj.name, type: parsePlaintext(obj.ty), mode: parseMode(obj.mode) }
}

function parseStruct(raw: unknown): StructDef {
  const obj = raw as { path: string[]; fields: unknown[] }
  return { path: obj.path, fields: obj.fields.map(parseStructField) }
}

function parseRecord(raw: unknown): RecordDef {
  const obj = raw as { path: string[]; fields: unknown[] }
  return { path: obj.path, fields: obj.fields.map(parseRecordField) }
}

// ---- Mapping ----

function parseMapping(raw: unknown): Mapping {
  const obj = raw as { name: string; key: unknown; value: unknown }
  return {
    name: obj.name,
    key: parsePlaintext(obj.key),
    value: parsePlaintext(obj.value),
  }
}

// ---- StorageType ----
// Leo JSON:
//   { "Plaintext": <Plaintext> }
//   { "Vector": <StorageType> }

function parseStorageType(raw: unknown): StorageType {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>

    if ('Plaintext' in obj) {
      return { kind: 'plaintext', type: parsePlaintext(obj.Plaintext) }
    }

    if ('Vector' in obj) {
      return { kind: 'vector', element: parseStorageType(obj.Vector) }
    }
  }

  throw new Error(`Unknown StorageType variant: ${JSON.stringify(raw)}`)
}

// ---- StorageVariable ----

function parseStorageVariable(raw: unknown): StorageVariable {
  const obj = raw as { name: string; ty: unknown }
  return { name: obj.name, type: parseStorageType(obj.ty) }
}

// ---- Storage variable reconstruction from mappings ----
//
// When an ABI comes from `leo abi <file.aleo>` (bytecode disassembler) rather
// than `leo build`, storage variables are absent — they've been lowered to
// mappings with a `__` suffix:
//
//   storage counter: u32     →  mapping counter__: boolean => u32
//   storage items: Vector<u64> →  mapping items__: u32 => u64
//                                 mapping items__len__: boolean => u32
//
// This function scans the parsed mappings, detects these patterns, and returns:
//   - storageVariables: reconstructed storage variables
//   - mappings: remaining mappings with storage mappings filtered out

function reconstructStorageVariables(mappings: Mapping[]): {
  storageVariables: StorageVariable[]
  mappings: Mapping[]
} {
  // Collect names of vector length mappings (name__len__ with boolean key)
  // so we can match them to their corresponding element mapping (name__ with u32 key)
  const vectorLenNames = new Set<string>()
  for (const m of mappings) {
    if (
      m.name.endsWith('__len__') &&
      m.key.kind === 'primitive' &&
      m.key.primitive === 'boolean'
    ) {
      // e.g. "items__len__" → "items__" is the element mapping name
      vectorLenNames.add(m.name.slice(0, -'len__'.length))
    }
  }

  const storageVariables: StorageVariable[] = []
  const regularMappings: Mapping[] = []

  for (const m of mappings) {
    if (m.name.endsWith('__len__') && m.key.kind === 'primitive' && m.key.primitive === 'boolean') {
      // Vector length mapping — consumed as part of the vector, not a regular mapping
      continue
    }

    if (m.name.endsWith('__') && m.key.kind === 'primitive' && m.key.primitive === 'boolean') {
      // Simple storage variable: counter__ (bool key) → storage counter: T
      const name = m.name.slice(0, -2)
      storageVariables.push({
        name,
        type: { kind: 'plaintext', type: m.value },
      })
      continue
    }

    if (m.name.endsWith('__') && m.key.kind === 'primitive' && m.key.primitive === 'u32' && vectorLenNames.has(m.name)) {
      // Vector element mapping: items__ (u32 key) → storage items: Vector<T>
      const name = m.name.slice(0, -2)
      storageVariables.push({
        name,
        type: { kind: 'vector', element: { kind: 'plaintext', type: m.value } },
      })
      continue
    }

    regularMappings.push(m)
  }

  return { storageVariables, mappings: regularMappings }
}

// ---- Program (full ABI) ----

export function parseAbi(raw: unknown): ABI {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid ABI: expected an object')
  }

  const obj = raw as {
    program: string
    structs: unknown[]
    records: unknown[]
    mappings: unknown[]
    storage_variables: unknown[]
    functions: unknown[]
  }

  const parsedMappings = obj.mappings.map(parseMapping)

  // If storage_variables are present in the JSON (from `leo build`), use them.
  // Otherwise reconstruct from the __ suffix convention (from `leo abi <file.aleo>`).
  const hasStorageVars = Array.isArray(obj.storage_variables) && obj.storage_variables.length > 0

  const { storageVariables, mappings } = hasStorageVars
    ? {
        storageVariables: obj.storage_variables.map(parseStorageVariable),
        mappings: parsedMappings,
      }
    : reconstructStorageVariables(parsedMappings)

  return {
    program: obj.program,
    structs: obj.structs.map(parseStruct),
    records: obj.records.map(parseRecord),
    mappings,
    storageVariables,
    functions: obj.functions.map(parseFunction),
  }
}
