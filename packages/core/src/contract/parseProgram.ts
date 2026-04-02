import type { Program, ProgramFunction, ProgramMapping } from '../types/program.js'

/**
 * Parses Aleo program source code into a structured Program object.
 * Extracts function signatures, mapping types, and closure names.
 */
export function parseProgram(source: string): Program {
  const idMatch = source.match(/program\s+([\w.]+)\s*;/)
  const id = idMatch ? idMatch[1]! : 'unknown.aleo'

  const functions = parseFunctions(source)
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

  return { id, source, functions, mappings, closures }
}

function parseFunctions(source: string): ProgramFunction[] {
  const functions: ProgramFunction[] = []
  // Match function blocks: "function name:" followed by inputs/outputs until the next block
  const fnRegex = /function\s+(\w+)\s*:([\s\S]*?)(?=\n(?:function|finalize|closure|mapping)\s|\n*$)/g
  let match: RegExpExecArray | null

  while ((match = fnRegex.exec(source)) !== null) {
    const name = match[1]!
    const body = match[2]!

    const inputs: ProgramFunction['inputs'] = []
    const inputRegex = /input\s+(\w+)\s+as\s+(\w+(?:\.\w+)?)\.(\w+)\s*;/g
    let inputMatch: RegExpExecArray | null
    while ((inputMatch = inputRegex.exec(body)) !== null) {
      inputs.push({
        name: inputMatch[1]!,
        type: inputMatch[2]!,
        visibility: inputMatch[3] as 'public' | 'private' | 'constant',
      })
    }

    const outputs: ProgramFunction['outputs'] = []
    const outputRegex = /output\s+\w+\s+as\s+(\w+(?:\.\w+)?)\.(\w+)\s*;/g
    let outputMatch: RegExpExecArray | null
    while ((outputMatch = outputRegex.exec(body)) !== null) {
      outputs.push({
        type: outputMatch[1]!,
        visibility: outputMatch[2] as 'public' | 'private',
      })
    }

    functions.push({ name, inputs, outputs, hasFinalize: false })
  }

  return functions
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
