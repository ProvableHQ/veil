/**
 * One register in a function or view signature, split into the base type and
 * the visibility suffix as written in Aleo instructions. Together the two
 * fields cover every snarkVM `ValueType` variant:
 *
 * - `u8.constant` / `address.public` / `u128.private` — plaintext types
 *   (including arrays like `[field; 16u32]`) with explicit visibility.
 * - `Token.record` — a record the program defines; `type` is the record name.
 * - `credits.aleo/credits.record` — an external record; `type` keeps the
 *   program-qualified locator.
 * - `token.aleo/fn.future` — a future; `type` keeps the locator.
 * - `dynamic.record` / `dynamic.future` — dynamic records and futures
 *   (Leo `dyn record`); `type` is the literal `dynamic`.
 *
 * @property name Register name (e.g. `r0`); absent on outputs.
 * @property type Base type with any visibility suffix removed.
 * @property visibility The suffix: `record` and `future` registers inherit
 *   visibility from their definition, so the suffix names the register kind
 *   rather than a plain/private split.
 */
export type ProgramRegister = {
  name?: string
  type: string
  visibility: 'public' | 'private' | 'constant' | 'record' | 'future'
}

/**
 * A function signature parsed from program source. Input and output types are
 * raw Aleo type strings — a looser view than the structured `AbiFunction`.
 * See {@link ProgramRegister} for how each snarkVM `ValueType` variant maps
 * onto the `type`/`visibility` pair.
 *
 * @property hasFinalize True if the function has an on-chain finalize block.
 */
export type ProgramFunction = {
  name: string
  inputs: Array<ProgramRegister & { name: string }>
  outputs: ProgramRegister[]
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
