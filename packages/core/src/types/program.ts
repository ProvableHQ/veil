/**
 * One register in a function or view signature, discriminated by `kind` the
 * way snarkVM's `ValueType` is. Covers every variant:
 *
 * - `plaintext` — a plaintext type with its explicit visibility
 *   (`.constant` / `.public` / `.private`). The base type is any snarkVM
 *   `PlaintextType`: a literal (`u8`, `address`, `signature`, `string`,
 *   `identifier`, …), a struct name (`Matrix`), an external struct locator
 *   (`credits.aleo/metadata`), or an array of any of these, which may nest
 *   (`[[field; 2u32]; 3u32]`).
 * - `record` — `Token.record` (a record the program defines; `type` is the
 *   record name), `credits.aleo/credits.record` (an external record; `type`
 *   keeps the program-qualified locator), or `dynamic.record` (Leo
 *   `dyn record`; `type` is the literal `dynamic`). Records carry no
 *   visibility at the signature level — visibility is declared per entry on
 *   the record type itself (see {@link ProgramRecord}).
 * - `future` — `token.aleo/fn.future` (`type` keeps the locator) or
 *   `dynamic.future` (`type` is the literal `dynamic`).
 *
 * @property name Register name (e.g. `r0`); absent on outputs.
 * @property type Base type with the kind/visibility suffix removed.
 * @property visibility Plaintext registers only — the declared visibility.
 */
export type ProgramRegister =
  | { name?: string; kind: 'plaintext'; type: string; visibility: 'constant' | 'public' | 'private' }
  | { name?: string; kind: 'record'; type: string }
  | { name?: string; kind: 'future'; type: string }

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
 * A record declaration parsed from program source. Each entry declares its
 * own visibility (snarkVM `EntryType`): `constant`, `public`, or `private`.
 * The `owner` entry is restricted to `public` or `private` by the VM.
 *
 * @property name Record type name, e.g. "Token".
 * @property fields Entries in declaration order, with raw Aleo type strings
 *   and each entry's declared visibility.
 */
export type ProgramRecord = {
  name: string
  fields: Array<{ name: string; type: string; visibility: 'constant' | 'public' | 'private' }>
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
