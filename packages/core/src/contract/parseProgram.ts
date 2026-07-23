import type { Program, ProgramFunction, ProgramMapping, ProgramRecord, ProgramRegister, ProgramStruct } from '../types/program.js'

/**
 * Parses Aleo program source code into a structured Program object.
 * Extracts function and view signatures, record and struct declarations,
 * mapping types, and closure names. Pure and local — no network access.
 */
export function parseProgram(source: string): Program {
  const idMatch = source.match(/program\s+([\w.]+)\s*;/)
  const id = idMatch ? idMatch[1]! : 'unknown.aleo'

  const functions = parseCallables(source, 'function')
  const views = parseCallables(source, 'view')
  // Record entries carry a visibility suffix (e.g. "address.private"); struct
  // fields carry none, so the parsed raw type is used verbatim.
  const records: ProgramRecord[] = parseFieldBlocks(source, 'record').map(({ name, fields }) => ({
    name,
    fields: fields.map((field) => ({ name: field.name, ...splitEntryType(field.type) })),
  }))
  const structs = parseFieldBlocks(source, 'struct')
  const mappings = parseMappings(source)
  const closures = parseClosures(source)

  // Mark functions that have a corresponding finalize block
  const finalizeNames = new Set<string>()
  const finalizeRegex = /finalize\s+(\w+)\s*:/g
  let match: RegExpExecArray | null
  while ((match = finalizeRegex.exec(source)) !== null) {
    finalizeNames.add(match[1]!)
  }
  for (const fn of functions) {
    fn.hasFinalize = finalizeNames.has(fn.name)
  }

  return { id, source, functions, views, records, structs, mappings, closures }
}

// A block body ends where indentation ends: the next top-level declaration
// (any non-whitespace at column 0) or the end of the source.
const BLOCK_BOUNDARY = String.raw`(?=\n\S|\n*$)`

// One register type as written in source: bracketed segments may contain
// semicolons ("[field; 16u32]"), everything else ends at the statement's
// semicolon. The alternation is disjoint ("[" is excluded from the fallback
// class) so matching stays linear on malformed input.
const REGISTER_TYPE = String.raw`((?:\[[^\]]*\]|[^;[])+)`

// Splits a raw register type like "address.public", "Token.record",
// "[MerkleProof; 2u32].private", or "prog.aleo/fn.future" into the register
// kind (mirroring snarkVM's ValueType variants) plus the base type, with the
// declared visibility on plaintext registers.
function splitRegisterType(raw: string): ProgramRegister {
  const match = raw.match(/^(.*)\.(constant|public|private|record|future)$/)
  if (!match) return { kind: 'plaintext', type: raw, visibility: 'private' }
  const type = match[1]!
  const suffix = match[2]!
  if (suffix === 'record' || suffix === 'future') return { kind: suffix, type }
  return { kind: 'plaintext', type, visibility: suffix as 'constant' | 'public' | 'private' }
}

// Splits a record entry type like "address.public" or "u128.private" into the
// base type and the entry's declared visibility (snarkVM EntryType).
function splitEntryType(raw: string): { type: string; visibility: 'constant' | 'public' | 'private' } {
  const match = raw.match(/^(.*)\.(constant|public|private)$/)
  if (!match) return { type: raw, visibility: 'private' }
  return { type: match[1]!, visibility: match[2] as 'constant' | 'public' | 'private' }
}

function parseCallables(source: string, keyword: 'function' | 'view'): ProgramFunction[] {
  const callables: ProgramFunction[] = []
  const blockRegex = new RegExp(`${keyword}\\s+(\\w+)\\s*:([\\s\\S]*?)${BLOCK_BOUNDARY}`, 'g')
  const inputRegex = new RegExp(String.raw`input\s+(\S+)\s+as\s+${REGISTER_TYPE};`, 'g')
  const outputRegex = new RegExp(String.raw`output\s+\S+\s+as\s+${REGISTER_TYPE};`, 'g')
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(source)) !== null) {
    const name = match[1]!
    const body = match[2]!

    const inputs: ProgramFunction['inputs'] = []
    inputRegex.lastIndex = 0
    let inputMatch: RegExpExecArray | null
    while ((inputMatch = inputRegex.exec(body)) !== null) {
      inputs.push({ ...splitRegisterType(inputMatch[2]!.trim()), name: inputMatch[1]! })
    }

    const outputs: ProgramFunction['outputs'] = []
    outputRegex.lastIndex = 0
    let outputMatch: RegExpExecArray | null
    while ((outputMatch = outputRegex.exec(body)) !== null) {
      outputs.push(splitRegisterType(outputMatch[1]!.trim()))
    }

    callables.push({ name, inputs, outputs, hasFinalize: false })
  }

  return callables
}

// Parses "record Name:" / "struct Name:" blocks into name plus raw field
// types — the caller strips visibility suffixes where the grammar has them.
function parseFieldBlocks(source: string, keyword: 'record' | 'struct'): ProgramStruct[] {
  const blocks: ProgramStruct[] = []
  const blockRegex = new RegExp(`^${keyword}\\s+(\\w+)\\s*:\\n((?:[ \\t]+.*\\n?)*)`, 'gm')
  const fieldRegex = new RegExp(String.raw`(\w+)\s+as\s+${REGISTER_TYPE};`, 'g')
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(source)) !== null) {
    const fields: ProgramStruct['fields'] = []
    fieldRegex.lastIndex = 0
    let fieldMatch: RegExpExecArray | null
    while ((fieldMatch = fieldRegex.exec(match[2]!)) !== null) {
      fields.push({ name: fieldMatch[1]!, type: fieldMatch[2]!.trim() })
    }
    blocks.push({ name: match[1]!, fields })
  }

  return blocks
}

function parseMappings(source: string): ProgramMapping[] {
  const mappings: ProgramMapping[] = []
  // Mapping format: "key as address.public;" — strip the visibility suffix (.public/.private)
  const mappingRegex = /mapping\s+(\w+)\s*:\s*\n\s*key\s+as\s+(\w+(?:\.\w+)?)\.(?:public|private)\s*;\s*\n\s*value\s+as\s+(\w+(?:\.\w+)?)\.(?:public|private)\s*;/g
  let match: RegExpExecArray | null

  while ((match = mappingRegex.exec(source)) !== null) {
    mappings.push({
      name: match[1]!,
      keyType: match[2]!,
      valueType: match[3]!,
    })
  }

  return mappings
}

function parseClosures(source: string): string[] {
  const closures: string[] = []
  const closureRegex = /closure\s+(\w+)\s*:/g
  let match: RegExpExecArray | null

  while ((match = closureRegex.exec(source)) !== null) {
    closures.push(match[1]!)
  }

  return closures
}
