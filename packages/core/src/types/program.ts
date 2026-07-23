/**
 * A function signature parsed from program source. Input and output types are
 * raw Aleo type strings (e.g. "u64", "[field; 16u32]", "Token" for records,
 * "token.aleo/fn" for futures) — a looser view than the structured
 * `AbiFunction`. The `record` and `future` visibilities mark record-typed and
 * future-typed registers, whose base type carries no plain/private split.
 *
 * @property hasFinalize True if the function has an on-chain finalize block.
 */
export type ProgramFunction = {
  name: string
  inputs: Array<{ name: string; type: string; visibility: 'public' | 'private' | 'constant' | 'record' | 'future' }>
  outputs: Array<{ type: string; visibility: 'public' | 'private' | 'constant' | 'record' | 'future' }>
  hasFinalize: boolean
}

/**
 * A record declaration parsed from program source.
 *
 * @property name Record type name, e.g. "Token".
 * @property fields Field entries in declaration order, with raw Aleo type
 *   strings and the on-chain visibility of each field.
 */
export type ProgramRecord = {
  name: string
  fields: Array<{ name: string; type: string; visibility: 'public' | 'private' }>
}

/**
 * A struct declaration parsed from program source. Struct fields carry no
 * visibility — they take the visibility of the value that contains them.
 *
 * @property fields Field entries in declaration order with raw Aleo type strings.
 */
export type ProgramStruct = {
  name: string
  fields: Array<{ name: string; type: string }>
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
  records: ProgramRecord[]
  structs: ProgramStruct[]
  /** Read-only `view` blocks (Leo `view fn`), parsed like functions; `hasFinalize` is always false. */
  views: ProgramFunction[]
  closures: string[]
}

/** One key-value entry read from an on-chain mapping, as Aleo-encoded strings. */
export type MappingValue = {
  key: string
  value: string
}
