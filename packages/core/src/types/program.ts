export type ProgramFunction = {
  name: string
  inputs: Array<{ name: string; type: string; visibility: 'public' | 'private' | 'constant' }>
  outputs: Array<{ type: string; visibility: 'public' | 'private' }>
  hasFinalize: boolean
}

export type ProgramMapping = {
  name: string
  keyType: string
  valueType: string
}

export type ProgramRecordField = {
  name: string
  type: string
  visibility?: 'public' | 'private'
}

export type ProgramRecord = {
  name: string
  fields: ProgramRecordField[]
}

export type ProgramStruct = {
  name: string
  fields: Array<{ name: string; type: string }>
}

export type Program = {
  id: string
  source: string
  imports: string[]
  mappings: ProgramMapping[]
  functions: ProgramFunction[]
  records: ProgramRecord[]
  structs: ProgramStruct[]
  closures: string[]
}

export type MappingValue = {
  key: string
  value: string
}

// ── Aleo compiler ABI JSON types ──────────────────────────────────────

export type AleoAbiType =
  | { Primitive: 'Address' | 'Boolean' | 'Field' | 'Group' | 'Scalar' | 'String' }
  | { Primitive: { UInt: 'U8' | 'U16' | 'U32' | 'U64' | 'U128' } }
  | { Primitive: { Int: 'I8' | 'I16' | 'I32' | 'I64' | 'I128' } }
  | 'Future'

export type AleoAbiPlaintextType =
  | { Plaintext: AleoAbiType | { Array: { element: AleoAbiType; length: number } } }

export type AleoAbiInputType =
  | AleoAbiPlaintextType
  | { Record: { path: string[]; program: string } }

export type AleoAbiOutputType =
  | AleoAbiPlaintextType
  | { Record: { path: string[]; program: string } }
  | 'Future'

export type AleoAbiTransition = {
  name: string
  is_async: boolean
  inputs: Array<{
    name: string
    ty: AleoAbiInputType
    mode: string
  }>
  outputs: Array<{
    ty: AleoAbiOutputType
    mode: string
  }>
}

export type AleoAbiRecord = {
  path: string[]
  fields: Array<{
    name: string
    ty: AleoAbiType | { Primitive: AleoAbiType }
    mode: string
  }>
}

export type AleoAbiMapping = {
  name: string
  key: AleoAbiType
  value: AleoAbiType
}

export type AleoAbiStruct = {
  path: string[]
  fields: Array<{
    name: string
    ty: AleoAbiType
    mode: string
  }>
}

export type AleoAbi = {
  program: string
  structs: AleoAbiStruct[]
  records: AleoAbiRecord[]
  mappings: AleoAbiMapping[]
  storage_variables?: unknown[]
  transitions: AleoAbiTransition[]
}
