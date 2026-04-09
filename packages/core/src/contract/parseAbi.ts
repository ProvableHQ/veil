import type {
  AleoAbi,
  AleoAbiType,
  AleoAbiInputType,
  AleoAbiOutputType,
  Program,
  ProgramFunction,
  ProgramMapping,
  ProgramRecord,
  ProgramStruct,
} from '../types/program.js'

/**
 * Identity helper that preserves the literal type of an ABI JSON object.
 *
 * Use this when you want TypeScript to infer exact function names and types
 * from your ABI for autocomplete and type checking. Without this (or `as const`),
 * TypeScript widens the JSON to generic string types and loses inference.
 *
 * @example
 * ```ts
 * import tokenAbiJson from './loyalty_token/build/abi.json' with { type: 'json' }
 * const tokenAbi = defineAbi(tokenAbiJson)
 * // tokenAbi has literal function names: 'mint_card' | 'add_points' | ...
 * ```
 */
export function defineAbi<const T extends AleoAbi>(abi: T): Program {
  return parseAbi(abi)
}

/**
 * Converts an Aleo compiler ABI JSON (abi.json) into aleo-viem's internal Program type.
 *
 * This is the preferred path for typed contract interactions — use the compiler's
 * canonical output rather than regex-parsing program source.
 *
 * @example
 * ```ts
 * import tokenAbi from './loyalty_token/build/abi.json' with { type: 'json' }
 * const program = parseAbi(tokenAbi)
 * const contract = getContract({ program: program.id, abi: program, client })
 * ```
 */
export function parseAbi(abi: AleoAbi): Program {
  return {
    id: abi.program,
    source: '',
    imports: extractImports(abi),
    functions: abi.transitions.map(mapTransition),
    mappings: abi.mappings.map(mapMapping),
    records: abi.records.map(mapRecord),
    structs: abi.structs.map(mapStruct),
    closures: [],
  }
}

function mapTransition(t: AleoAbi['transitions'][number]): ProgramFunction {
  return {
    name: t.name,
    hasFinalize: t.is_async,
    inputs: t.inputs.map((input) => ({
      name: input.name,
      type: resolveInputType(input.ty),
      visibility: (input.mode === 'None' ? 'private' : input.mode.toLowerCase()) as 'public' | 'private' | 'constant',
    })),
    outputs: t.outputs
      .filter((o) => o.ty !== 'Future')
      .map((output) => ({
        type: resolveOutputType(output.ty),
        visibility: (output.mode === 'None' ? 'private' : output.mode.toLowerCase()) as 'public' | 'private',
      })),
  }
}

function mapMapping(m: AleoAbi['mappings'][number]): ProgramMapping {
  return {
    name: m.name,
    keyType: resolvePrimitiveType(m.key),
    valueType: resolvePrimitiveType(m.value),
  }
}

function mapRecord(r: AleoAbi['records'][number]): ProgramRecord {
  return {
    name: r.path[r.path.length - 1] ?? 'unknown',
    fields: r.fields
      .filter((f) => !f.name.startsWith('_'))
      .map((f) => ({
        name: f.name,
        type: resolvePrimitiveType(f.ty as AleoAbiType),
        visibility: f.mode === 'None' ? undefined : (f.mode.toLowerCase() as 'public' | 'private'),
      })),
  }
}

function mapStruct(s: AleoAbi['structs'][number]): ProgramStruct {
  return {
    name: s.path[s.path.length - 1] ?? 'unknown',
    fields: s.fields.map((f) => ({
      name: f.name,
      type: resolvePrimitiveType(f.ty),
    })),
  }
}

/** Extract program IDs referenced by Record-typed inputs/outputs */
function extractImports(abi: AleoAbi): string[] {
  const ownProgram = abi.program.replace(/\.aleo$/, '')
  const programs = new Set<string>()

  for (const t of abi.transitions) {
    for (const input of t.inputs) {
      if ('Record' in input.ty) {
        const prog = (input.ty as { Record: { program: string } }).Record.program
        if (prog !== ownProgram) programs.add(`${prog}.aleo`)
      }
    }
    for (const output of t.outputs) {
      if (typeof output.ty === 'object' && output.ty !== null && 'Record' in output.ty) {
        const prog = (output.ty as { Record: { program: string } }).Record.program
        if (prog !== ownProgram) programs.add(`${prog}.aleo`)
      }
    }
  }

  return [...programs]
}

function resolveInputType(ty: AleoAbiInputType): string {
  if ('Plaintext' in ty) {
    return resolvePlaintextInner(ty.Plaintext)
  }
  if ('Record' in ty) {
    return ty.Record.path[ty.Record.path.length - 1] ?? 'record'
  }
  return 'unknown'
}

function resolveOutputType(ty: AleoAbiOutputType): string {
  if (ty === 'Future') return 'future'
  if ('Plaintext' in ty) {
    return resolvePlaintextInner((ty as { Plaintext: AleoAbiType }).Plaintext)
  }
  if ('Record' in ty) {
    return (ty as { Record: { path: string[] } }).Record.path[(ty as { Record: { path: string[] } }).Record.path.length - 1] ?? 'record'
  }
  return 'unknown'
}

function resolvePlaintextInner(inner: AleoAbiType | { Array: { element: AleoAbiType; length: number } }): string {
  if (typeof inner === 'object' && 'Array' in inner) {
    return `[${resolvePrimitiveType(inner.Array.element)}; ${inner.Array.length}]`
  }
  return resolvePrimitiveType(inner as AleoAbiType)
}

function resolvePrimitiveType(ty: AleoAbiType): string {
  if (typeof ty === 'string') return ty.toLowerCase()
  if ('Primitive' in ty) {
    const prim = ty.Primitive
    if (typeof prim === 'string') return prim.toLowerCase()
    if ('UInt' in prim) return prim.UInt.toLowerCase()
    if ('Int' in prim) return prim.Int.toLowerCase()
  }
  return 'unknown'
}
