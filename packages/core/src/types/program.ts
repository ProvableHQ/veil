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

export type Program = {
  id: string
  source: string
  mappings: ProgramMapping[]
  functions: ProgramFunction[]
  closures: string[]
}

export type MappingValue = {
  key: string
  value: string
}
