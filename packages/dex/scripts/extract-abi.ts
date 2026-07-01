/**
 * Fetches the deployed shield_swap_v0_0_1.aleo program source from the Provable
 * testnet node API and converts it to the Leo ABI JSON format that parseAbi
 * (from @veil/core) accepts. Writes the result to abi/shield_swap_v0_0_1.json.
 *
 * Run with: pnpm --filter @veil/dex exec tsx scripts/extract-abi.ts
 *
 * The generated file is committed and serves as the pinned ABI snapshot consumed
 * by @veil/codegen (Task 0.3) to produce typed TypeScript bindings.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROGRAM_ID = 'shield_swap_v0_0_1.aleo'
const API_URL = `https://api.provable.com/v2/testnet/program/${PROGRAM_ID}`

// Maps Aleo primitive type names (from .aleo source) to Leo ABI JSON Primitive values.
const PRIMITIVE_MAP: Record<string, unknown> = {
  address: 'Address',
  boolean: 'Boolean',
  field: 'Field',
  group: 'Group',
  scalar: 'Scalar',
  signature: 'Signature',
  u8: { UInt: 'U8' },
  u16: { UInt: 'U16' },
  u32: { UInt: 'U32' },
  u64: { UInt: 'U64' },
  u128: { UInt: 'U128' },
  i8: { Int: 'I8' },
  i16: { Int: 'I16' },
  i32: { Int: 'I32' },
  i64: { Int: 'I64' },
  i128: { Int: 'I128' },
}

// Converts a bare Aleo type name (no visibility suffix) to a Leo ABI Plaintext
// JSON value. Handles primitives and struct references.
// e.g. "field" → { "Primitive": "Field" }
//      "SwapRequest" → { "Struct": { "path": ["SwapRequest"], "program": PROGRAM_ID } }
function asTy(typeName: string, programId: string): unknown {
  const primitive = PRIMITIVE_MAP[typeName]
  if (primitive !== undefined) {
    return { Primitive: primitive }
  }
  // Struct reference (capitalised name not in the primitive map)
  return { Struct: { path: [typeName], program: programId } }
}

// Visibility suffix from .aleo source → capitalized mode string for Leo ABI JSON.
const MODE_MAP: Record<string, string> = {
  public: 'Public',
  private: 'Private',
  constant: 'Constant',
}

// ---- Input parsing ----
//
// .aleo input format:  "input rN as TYPE.VISIBILITY;"
// Possible types:
//   field.public, address.private, u128.public    → Plaintext
//   SwapRequest.public, PoolState.public           → Plaintext (Struct)
//   PositionNFT.record                             → Record (own program)
//   dynamic.record                                 → DynamicRecord
//
// Returns a Leo ABI input object { name, ty, mode }.

function buildInput(
  name: string,
  rawType: string,
  visibility: string,
  programId: string,
  knownStructs: Set<string>,
): unknown {
  if (rawType === 'dynamic' && visibility === 'record') {
    return { name, ty: 'DynamicRecord', mode: 'None' }
  }

  if (visibility === 'record') {
    // e.g. "PositionNFT.record" — record type from this program
    return {
      name,
      ty: { Record: { path: [rawType], program: programId } },
      mode: 'None',
    }
  }

  const mode = MODE_MAP[visibility] ?? 'None'

  // Struct type used as plaintext input (e.g. "SwapRequest.public")
  if (knownStructs.has(rawType)) {
    return {
      name,
      ty: { Plaintext: { Struct: { path: [rawType], program: programId } } },
      mode,
    }
  }

  // Primitive type
  return {
    name,
    ty: { Plaintext: asTy(rawType, programId) },
    mode,
  }
}

// ---- Output parsing ----
//
// .aleo output format:  "output rN as TYPE.VISIBILITY;"
// Possible types:
//   field.public                                   → Plaintext primitive
//   PositionNFT.record                             → Record
//   dynamic.record                                 → DynamicRecord
//   shield_swap_v0_0_1.aleo/func_name.future       → Final (handled in caller)
//
// Returns a Leo ABI output object { ty, mode }.

function buildOutput(
  rawType: string,
  visibility: string,
  programId: string,
  knownStructs: Set<string>,
): unknown {
  if (rawType === 'dynamic' && visibility === 'record') {
    return { ty: 'DynamicRecord', mode: 'None' }
  }

  if (visibility === 'future') {
    return { ty: 'Final', mode: 'None' }
  }

  if (visibility === 'record') {
    return {
      ty: { Record: { path: [rawType], program: programId } },
      mode: 'None',
    }
  }

  // Preserve the declared visibility for plaintext outputs so callers can
  // distinguish public from private outputs via Output.mode.
  const mode = MODE_MAP[visibility] ?? 'None'

  if (knownStructs.has(rawType)) {
    return {
      ty: { Plaintext: { Struct: { path: [rawType], program: programId } } },
      mode,
    }
  }

  return {
    ty: { Plaintext: asTy(rawType, programId) },
    mode,
  }
}

// ---- Source parser ----
//
// Parses a .aleo program source string into the Leo ABI JSON object that
// parseAbi (from @veil/core) expects. Handles:
//   - structs (with field types)
//   - records (with field types and visibilities)
//   - mappings (key/value types)
//   - functions (inputs and outputs, including dynamic.record and futures)

// The trailing \n? makes the last field optional even when the source lacks a
// final newline (some API responses omit it), preventing silent field truncation.
const STRUCT_BLOCK_RE = /^struct\s+(\w+)\s*:\s*\n((?:[ \t]+\w[^\n]*\n?)*)/gm
const RECORD_BLOCK_RE = /^record\s+(\w+)\s*:\s*\n((?:[ \t]+\w[^\n]*\n?)*)/gm
const MAPPING_RE = /^mapping\s+(\w+)\s*:\s*\n\s*key\s+as\s+(\w+)\.(?:public|private)\s*;\s*\n\s*value\s+as\s+(\w+)\.(?:public|private)\s*;/gm
// Splits on any top-level keyword to extract function bodies in O(n).
const TOP_LEVEL_SPLIT_RE = /^(?=function\s|finalize\s|closure\s|mapping\s|struct\s|record\s|program\s)/gm

function programToAbi(source: string): unknown {
  const programMatch = source.match(/^program\s+([\w.]+)\s*;/m)
  if (!programMatch) throw new Error('Cannot extract program ID from source')
  const programId = programMatch[1]!

  // knownStructs and knownRecords are populated during the struct/record block
  // loops (no separate pre-scan needed — the block regex captures the same names).
  const knownStructs = new Set<string>()
  const knownRecords = new Set<string>()

  // ---- Structs ----
  const structs: unknown[] = []
  for (const block of source.matchAll(STRUCT_BLOCK_RE)) {
    const name = block[1]!
    knownStructs.add(name)
    const body = block[2]!
    const fields = []
    // Struct fields: "    field_name as type;" (no visibility suffix in structs)
    for (const line of body.split('\n')) {
      const m = line.match(/^\s+(\w+)\s+as\s+(\w+)\s*;/)
      if (!m) continue
      const [, fieldName, fieldType] = m
      fields.push({ name: fieldName, ty: asTy(fieldType!, programId) })
    }
    structs.push({ path: [name], fields })
  }

  // ---- Records ----
  const records: unknown[] = []
  for (const block of source.matchAll(RECORD_BLOCK_RE)) {
    const name = block[1]!
    knownRecords.add(name)
    const body = block[2]!
    const fields = []
    // Record fields: "    field_name as type.visibility;"
    for (const line of body.split('\n')) {
      const m = line.match(/^\s+(\w+)\s+as\s+(\w+(?:\.\w+)?)\.(\w+)\s*;/)
      if (!m) continue
      const [, fieldName, fieldType, fieldVis] = m
      // For record fields, the type is either a primitive or a struct reference.
      // The visibility (private/public) becomes the field mode.
      let ty: unknown
      if (fieldType === 'dynamic') {
        // Dynamic-typed record fields are not representable in Leo ABI JSON. No
        // known Aleo program uses them, and silently mapping to Field would
        // produce a corrupt ABI. Throw so the caller can decide how to handle.
        throw new Error(`Record '${name}' field '${fieldName}' has unsupported dynamic type`)
      } else if (knownStructs.has(fieldType!)) {
        ty = { Struct: { path: [fieldType], program: programId } }
      } else {
        ty = asTy(fieldType!, programId)
      }
      const mode = MODE_MAP[fieldVis!] ?? 'None'
      fields.push({ name: fieldName, ty, mode })
    }
    records.push({ path: [name], fields })
  }

  // ---- Mappings ----
  const mappings: unknown[] = []
  for (const m of source.matchAll(MAPPING_RE)) {
    const [, mapName, keyType, valType] = m
    mappings.push({
      name: mapName,
      key: asTy(keyType!, programId),
      value: asTy(valType!, programId),
    })
  }

  // ---- Functions ----
  //
  // Split the source on top-level keyword boundaries (O(n)) to extract each
  // function block, then parse inputs and outputs from the body only.
  // Using a split avoids the O(n²) negative-lookahead regex.
  const functions: unknown[] = []
  const segments = source.split(TOP_LEVEL_SPLIT_RE)

  for (const segment of segments) {
    const fnMatch = segment.match(/^function\s+(\w+)\s*:\n/)
    if (!fnMatch) continue

    const fnName = fnMatch[1]!
    // Body is everything after the "function name:\n" header line.
    const body = segment.slice(fnMatch[0].length)

    const inputs: unknown[] = []
    const outputs: unknown[] = []

    // Parse inputs: "    input rN as TYPE.VISIBILITY;"
    // TYPE.VISIBILITY can be:
    //   field.public, address.private, u128.public
    //   SwapRequest.public (struct)
    //   PositionNFT.record (record)
    //   dynamic.record (dynamic record)
    const inputRegex = /^\s+input\s+(\w+)\s+as\s+(\w+)\.(\w+)\s*;/gm
    for (const m of body.matchAll(inputRegex)) {
      const [, regName, rawType, visibility] = m
      inputs.push(buildInput(regName!, rawType!, visibility!, programId, knownStructs))
    }

    // Parse outputs: "    output rN as TYPE.VISIBILITY;"
    // Output type can include:
    //   field.public, address.public
    //   PositionNFT.record
    //   dynamic.record
    //   shield_swap_v0_0_1.aleo/func_name.future  (qualified future)
    const outputRegex = /^\s+output\s+\S+\s+as\s+(\S+)\s*;/gm
    for (const m of body.matchAll(outputRegex)) {
      const typeSpec = m[1]!

      // Qualified future: "program.aleo/funcname.future"
      if (typeSpec.includes('/')) {
        outputs.push({ ty: 'Final', mode: 'None' })
        continue
      }

      const dotIdx = typeSpec.lastIndexOf('.')
      if (dotIdx === -1) {
        // Shouldn't happen in valid .aleo, but skip gracefully
        continue
      }

      const rawType = typeSpec.slice(0, dotIdx)
      const visibility = typeSpec.slice(dotIdx + 1)

      outputs.push(buildOutput(rawType, visibility, programId, knownStructs))
    }

    // A function is final if any of its outputs is a future/finalize output.
    const isFinal = outputs.some((o) => (o as { ty: unknown }).ty === 'Final')

    functions.push({
      name: fnName,
      is_final: isFinal,
      const_parameters: [],
      inputs,
      outputs,
    })
  }

  return {
    program: programId,
    structs,
    records,
    mappings,
    storage_variables: [],
    functions,
  }
}

// ---- Main ----

async function main(): Promise<void> {
  console.log(`Fetching ${PROGRAM_ID} from ${API_URL} …`)
  const res = await fetch(API_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

  // The API returns the .aleo source as a JSON-encoded string — decode it.
  const raw: unknown = await res.json()
  if (typeof raw !== 'string') throw new Error(`Unexpected response shape: ${JSON.stringify(raw).slice(0, 200)}`)

  const abi = programToAbi(raw)

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const outDir = join(__dirname, '..', 'abi')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'shield_swap_v0_0_1.json')
  writeFileSync(outPath, JSON.stringify(abi, null, 2) + '\n')
  console.log(`Written: ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
