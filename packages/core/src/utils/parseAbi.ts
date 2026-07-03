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

    if ('RecordWithDynamicId' in obj) {
      const r = obj.RecordWithDynamicId as { path: string[]; program?: string; dynamic_id: string }
      return { kind: 'record', path: r.path, program: r.program, dynamicId: r.dynamic_id }
    }

    if ('ExternalRecordWithDynamicId' in obj) {
      const r = obj.ExternalRecordWithDynamicId as { program: string; dynamic_id: string }
      return { kind: 'record', path: [], program: r.program, dynamicId: r.dynamic_id }
    }
  }

  throw new Error(`Unknown FunctionInput variant: ${JSON.stringify(raw)}`)
}

// ---- FunctionOutput ----

function parseFunctionOutput(raw: unknown): FunctionOutput {
  if (raw === 'DynamicRecord') return { kind: 'dynamicRecord' }
  if (raw === 'Final' || raw === 'Future') return { kind: 'future' }
  if (raw === 'DynamicFuture') return { kind: 'dynamicFuture' }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>

    if ('Plaintext' in obj) {
      return { kind: 'plaintext', type: parsePlaintext(obj.Plaintext) }
    }

    if ('Record' in obj) {
      const r = obj.Record as { path: string[]; program?: string }
      return { kind: 'record', path: r.path, program: r.program }
    }

    if ('RecordWithDynamicId' in obj) {
      const r = obj.RecordWithDynamicId as { path: string[]; program?: string; dynamic_id: string }
      return { kind: 'record', path: r.path, program: r.program, dynamicId: r.dynamic_id }
    }

    if ('ExternalRecordWithDynamicId' in obj) {
      const r = obj.ExternalRecordWithDynamicId as { program: string; dynamic_id: string }
      return { kind: 'record', path: [], program: r.program, dynamicId: r.dynamic_id }
    }
  }

  throw new Error(`Unknown FunctionOutput variant: ${JSON.stringify(raw)}`)
}

// ---- Input / Output ----

// Leo 4.2.0's `leo abi` nests `mode` *inside* the type variant —
//   { "Plaintext": { "ty": <Plaintext>, "mode": "Public" } }
//   { "Record": { "path": [...], "program": "...", "mode": "Private" } }
//   "DynamicRecord" | "Final" | "Future"        (bare string, no mode)
// whereas older leo (and `leo build`) put `mode` alongside `ty`:
//   { "ty": { "Plaintext": <Plaintext> }, "mode": "Public" }
// Normalize the 4.2.0 shape back to `{ ty, mode }` so the variant parsers
// (which predate 4.2.0) keep working and both formats are accepted.
function normalizeIoEntry(raw: unknown): { ty: unknown; mode: unknown; name?: string } {
  // Bare string variants carry no mode.
  if (typeof raw === 'string') return { ty: raw, mode: 'None' }

  const obj = raw as Record<string, unknown>

  // Older shape: `ty` sits alongside `mode` (and optional `name`).
  if ('ty' in obj) {
    return { ty: obj.ty, mode: obj.mode ?? 'None', name: obj.name as string | undefined }
  }

  // 4.2.0 shape: the sole key is the variant, whose payload carries the mode.
  if ('Plaintext' in obj) {
    const p = obj.Plaintext as { ty: unknown; mode?: unknown }
    return { ty: { Plaintext: p.ty }, mode: p.mode ?? 'None' }
  }
  for (const variant of ['Record', 'RecordWithDynamicId', 'ExternalRecordWithDynamicId'] as const) {
    if (variant in obj) {
      const { mode, ...rest } = obj[variant] as Record<string, unknown>
      return { ty: { [variant]: rest }, mode: mode ?? 'None' }
    }
  }

  throw new Error(`Unknown ABI input/output entry: ${JSON.stringify(raw)}`)
}

function parseInput(raw: unknown): Input {
  const { ty, mode, name } = normalizeIoEntry(raw)
  return {
    name,
    type: parseFunctionInput(ty),
    mode: parseMode(mode),
  }
}

function parseOutput(raw: unknown): Output {
  const { ty, mode } = normalizeIoEntry(raw)
  return {
    type: parseFunctionOutput(ty),
    mode: parseMode(mode),
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
  const storageVariables: StorageVariable[] = []
  const regularMappings: Mapping[] = []

  // Candidates: mappings ending with __ and a u32 key that might be vectors.
  // We collect them separately and resolve after the main pass once we know
  // which ones have a corresponding __len__ mapping.
  const vectorCandidates = new Map<string, Mapping>() // name__ → mapping
  const lenMappingNames = new Set<string>()            // name__ of confirmed vectors

  for (const m of mappings) {
    if (m.name.endsWith('__len__') && m.key.kind === 'primitive' && m.key.primitive === 'boolean') {
      // e.g. "items__len__" → record that "items__" has a length mapping
      lenMappingNames.add(m.name.slice(0, -'len__'.length))
      continue
    }

    if (m.name.endsWith('__') && m.key.kind === 'primitive' && m.key.primitive === 'boolean') {
      // Simple storage variable: counter__ (bool key) → storage counter: T
      storageVariables.push({ name: m.name.slice(0, -2), type: { kind: 'plaintext', type: m.value } })
      continue
    }

    if (m.name.endsWith('__') && m.key.kind === 'primitive' && m.key.primitive === 'u32') {
      // Possible vector — defer until we've seen all mappings
      vectorCandidates.set(m.name, m)
      continue
    }

    regularMappings.push(m)
  }

  // Resolve vector candidates — only confirmed if a __len__ mapping was also seen
  for (const [name, m] of vectorCandidates) {
    if (lenMappingNames.has(name)) {
      storageVariables.push({
        name: name.slice(0, -2),
        type: { kind: 'vector', element: { kind: 'plaintext', type: m.value } },
      })
    } else {
      // No corresponding __len__ — treat as a regular mapping
      regularMappings.push(m)
    }
  }

  return { storageVariables, mappings: regularMappings }
}

// ---- Program (full ABI) ----

/**
 * Parses Leo ABI JSON into Veil's `ABI` type.
 *
 * Accepts output from both `leo build` and `leo abi`, normalizing their
 * differences — `transitions` vs `functions`, `is_async` vs `is_final`,
 * mode placement — and reconstructing storage variables from their lowered
 * `__`-suffixed mappings when the ABI comes from disassembled bytecode.
 * Local, no network; mutates `raw` in place during normalization.
 *
 * @param raw Parsed JSON of the ABI file.
 * @returns The normalized ABI with functions, structs, records, mappings,
 *   and storage variables.
 * @throws If the JSON is not an object or contains unknown Leo variants.
 *
 * @example
 * const abi = parseAbi(JSON.parse(abiJson))
 * abi.functions.map((f) => f.name)
 */
export function parseAbi(raw: unknown): ABI {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid ABI: expected an object')
  }

  // Normalize Leo compiler format differences:
  // - `transitions` → `functions` (leo build uses transitions, leo abi uses functions)
  // - `is_async` → `is_final` (same concept, different naming)
  // - `"Future"` → `"Final"` in output types
  const r = raw as Record<string, unknown>
  if (r.transitions && !r.functions) {
    r.functions = r.transitions
  }
  if (Array.isArray(r.functions)) {
    for (const fn of r.functions as Record<string, unknown>[]) {
      if ('is_async' in fn && !('is_final' in fn)) {
        fn.is_final = fn.is_async
      }
      // leo 4.2.0 `leo abi` omits is_final/is_async; a finalize surfaces as a
      // "Final" (or "Future") entry in the function's outputs.
      if (!('is_final' in fn) && !('is_async' in fn)) {
        fn.is_final =
          Array.isArray(fn.outputs) &&
          (fn.outputs as unknown[]).some((o) => o === 'Final' || o === 'Future')
      }
      if (Array.isArray(fn.outputs)) {
        for (const output of fn.outputs as Record<string, unknown>[]) {
          if (output.ty === 'Future') output.ty = 'Final'
        }
      }
    }
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
