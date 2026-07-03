/**
 * A function signature parsed from program source. Input and output types are
 * raw Aleo type strings (e.g. "u64", "token.aleo/credits.record") — a looser
 * view than the structured `AbiFunction`.
 *
 * @property hasFinalize True if the function has an on-chain finalize block.
 */
export type ProgramFunction = {
  name: string
  inputs: Array<{ name: string; type: string; visibility: 'public' | 'private' | 'constant' }>
  outputs: Array<{ type: string; visibility: 'public' | 'private' }>
  hasFinalize: boolean
}

/** A mapping declaration parsed from program source, with raw Aleo type strings for key and value. */
export type ProgramMapping = {
  name: string
  keyType: string
  valueType: string
}

/**
 * A deployed program with its source and the interface parsed from it
 * (see `parseProgram`).
 *
 * @property id Program id (e.g. "credits.aleo").
 * @property closures Names of the closures the program defines.
 */
export type Program = {
  id: string
  source: string
  mappings: ProgramMapping[]
  functions: ProgramFunction[]
  closures: string[]
}

/** One key-value entry read from an on-chain mapping, as Aleo-encoded strings. */
export type MappingValue = {
  key: string
  value: string
}
