import { describe, it, expect } from 'vitest'
import { parseAbi } from '../../src/utils/parseAbi.js'

// Fixtures derived from real `leo abi` output on tictactoe.aleo and storage_var.aleo.
// These cover the main variants you'll encounter in practice.

// ---- tictactoe.aleo ----
// A simple game contract with structs, a record, mappings, and functions.
const TICTACTOE_ABI = {
  program: 'tictactoe.aleo',
  structs: [
    {
      path: ['Row'],
      fields: [
        { name: 'c1', ty: { Primitive: { UInt: 'U8' } } },
        { name: 'c2', ty: { Primitive: { UInt: 'U8' } } },
        { name: 'c3', ty: { Primitive: { UInt: 'U8' } } },
      ],
    },
    {
      path: ['Board'],
      fields: [
        { name: 'r1', ty: { Struct: { path: ['Row'], program: 'tictactoe.aleo' } } },
        { name: 'r2', ty: { Struct: { path: ['Row'], program: 'tictactoe.aleo' } } },
        { name: 'r3', ty: { Struct: { path: ['Row'], program: 'tictactoe.aleo' } } },
      ],
    },
  ],
  records: [
    {
      path: ['BoardState'],
      fields: [
        { name: 'player_1', ty: { Primitive: 'Address' }, mode: 'Private' },
        { name: 'player_2', ty: { Primitive: 'Address' }, mode: 'Private' },
        { name: 'board',    ty: { Struct: { path: ['Board'], program: 'tictactoe.aleo' } }, mode: 'Private' },
        { name: 'game_started', ty: { Primitive: 'Boolean' }, mode: 'Private' },
      ],
    },
  ],
  mappings: [
    {
      name: 'boards',
      key:   { Primitive: 'Address' },
      value: { Struct: { path: ['Board'], program: 'tictactoe.aleo' } },
    },
  ],
  storage_variables: [],
  functions: [
    {
      name: 'start_game',
      is_final: false,
      inputs: [
        { name: 'player_2', ty: { Plaintext: { Primitive: 'Address' } }, mode: 'Public' },
      ],
      outputs: [
        { ty: { Record: { path: ['BoardState'], program: 'tictactoe.aleo' } }, mode: 'Private' },
      ],
    },
    {
      name: 'make_move',
      is_final: true,
      inputs: [
        { name: 'board_state', ty: { Record: { path: ['BoardState'], program: 'tictactoe.aleo' } }, mode: 'None' },
        { name: 'row', ty: { Plaintext: { Primitive: { UInt: 'U8' } } }, mode: 'Public' },
        { name: 'col', ty: { Plaintext: { Primitive: { UInt: 'U8' } } }, mode: 'Public' },
      ],
      outputs: [
        { ty: { Record: { path: ['BoardState'], program: 'tictactoe.aleo' } }, mode: 'Private' },
        { ty: 'Final', mode: 'None' },
      ],
    },
  ],
}

// ---- storage_var.aleo ----
// Exercises storage variables and the StorageType variants.
const STORAGE_VAR_ABI = {
  program: 'storage_var.aleo',
  structs: [],
  records: [],
  mappings: [],
  storage_variables: [
    {
      name: 'counter',
      ty: { Plaintext: { Primitive: { UInt: 'U32' } } },
    },
    {
      name: 'items',
      ty: { Vector: { Plaintext: { Primitive: { UInt: 'U64' } } } },
    },
  ],
  functions: [
    {
      name: 'increment',
      is_final: true,
      inputs: [],
      outputs: [{ ty: 'Final', mode: 'None' }],
    },
  ],
}

// ---- Tests ----

describe('parseAbi — tictactoe', () => {
  it('parses program identifier', () => {
    const abi = parseAbi(TICTACTOE_ABI)
    expect(abi.program).toBe('tictactoe.aleo')
  })

  it('parses struct definitions', () => {
    const abi = parseAbi(TICTACTOE_ABI)
    expect(abi.structs).toHaveLength(2)
    expect(abi.structs[0]).toEqual({
      path: ['Row'],
      fields: [
        { name: 'c1', type: { kind: 'primitive', primitive: 'u8' } },
        { name: 'c2', type: { kind: 'primitive', primitive: 'u8' } },
        { name: 'c3', type: { kind: 'primitive', primitive: 'u8' } },
      ],
    })
    expect(abi.structs[1]).toEqual({
      path: ['Board'],
      fields: [
        { name: 'r1', type: { kind: 'struct', path: ['Row'], program: 'tictactoe.aleo' } },
        { name: 'r2', type: { kind: 'struct', path: ['Row'], program: 'tictactoe.aleo' } },
        { name: 'r3', type: { kind: 'struct', path: ['Row'], program: 'tictactoe.aleo' } },
      ],
    })
  })

  it('parses record definitions', () => {
    const abi = parseAbi(TICTACTOE_ABI)
    expect(abi.records).toHaveLength(1)
    expect(abi.records[0]!.path).toEqual(['BoardState'])
    expect(abi.records[0]!.fields[0]).toEqual({
      name: 'player_1',
      type: { kind: 'primitive', primitive: 'address' },
      mode: 'private',
    })
  })

  it('parses mappings', () => {
    const abi = parseAbi(TICTACTOE_ABI)
    expect(abi.mappings).toHaveLength(1)
    expect(abi.mappings[0]).toEqual({
      name: 'boards',
      key:   { kind: 'primitive', primitive: 'address' },
      value: { kind: 'struct', path: ['Board'], program: 'tictactoe.aleo' },
    })
  })

  it('parses a non-final function with plaintext and record I/O', () => {
    const abi = parseAbi(TICTACTOE_ABI)
    const fn0 = abi.functions[0]!
    expect(fn0.name).toBe('start_game')
    expect(fn0.isFinal).toBe(false)
    expect(fn0.inputs[0]).toEqual({
      name: 'player_2',
      type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } },
      mode: 'public',
    })
    expect(fn0.outputs[0]).toEqual({
      type: { kind: 'record', path: ['BoardState'], program: 'tictactoe.aleo' },
      mode: 'private',
    })
  })

  it('parses a final function with a record input and Final output', () => {
    const abi = parseAbi(TICTACTOE_ABI)
    const fn1 = abi.functions[1]!
    expect(fn1.name).toBe('make_move')
    expect(fn1.isFinal).toBe(true)
    expect(fn1.inputs[0]).toEqual({
      name: 'board_state',
      type: { kind: 'record', path: ['BoardState'], program: 'tictactoe.aleo' },
      mode: 'none',
    })
    expect(fn1.outputs[1]).toEqual({
      type: { kind: 'future' },
      mode: 'none',
    })
  })
})

describe('parseAbi — storage_var', () => {
  it('parses plaintext storage variable', () => {
    const abi = parseAbi(STORAGE_VAR_ABI)
    expect(abi.storageVariables[0]).toEqual({
      name: 'counter',
      type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u32' } },
    })
  })

  it('parses vector storage variable', () => {
    const abi = parseAbi(STORAGE_VAR_ABI)
    expect(abi.storageVariables[1]).toEqual({
      name: 'items',
      type: {
        kind: 'vector',
        element: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u64' } },
      },
    })
  })

  it('parses final-only function', () => {
    const abi = parseAbi(STORAGE_VAR_ABI)
    const fn0 = abi.functions[0]!
    expect(fn0.name).toBe('increment')
    expect(fn0.isFinal).toBe(true)
    expect(fn0.inputs).toHaveLength(0)
    expect(fn0.outputs[0]).toEqual({ type: { kind: 'future' }, mode: 'none' })
  })
})

// ---- Bytecode disassembler ABI (no storage_variables, must reconstruct from mappings) ----
// This is what you get from `leo abi <file.aleo>` rather than `leo build`.
const BYTECODE_STORAGE_ABI = {
  program: 'storage_var.aleo',
  structs: [],
  records: [],
  // Storage variables have been lowered to mappings:
  //   storage counter: u32       →  mapping counter__: boolean => u32
  //   storage items: Vector<u64> →  mapping items__: u32 => u64
  //                                 mapping items__len__: boolean => u32
  // Plus a regular mapping that should NOT be treated as a storage variable.
  mappings: [
    { name: 'counter__',    key: { Primitive: 'Boolean' }, value: { Primitive: { UInt: 'U32' } } },
    { name: 'items__',      key: { Primitive: { UInt: 'U32' } }, value: { Primitive: { UInt: 'U64' } } },
    { name: 'items__len__', key: { Primitive: 'Boolean' }, value: { Primitive: { UInt: 'U32' } } },
    { name: 'scores',       key: { Primitive: 'Address' }, value: { Primitive: { UInt: 'U64' } } },
  ],
  storage_variables: [],
  functions: [],
}

describe('parseAbi — storage variable reconstruction from bytecode ABI', () => {
  it('reconstructs a simple storage variable from __ mapping', () => {
    const abi = parseAbi(BYTECODE_STORAGE_ABI)
    expect(abi.storageVariables).toContainEqual({
      name: 'counter',
      type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u32' } },
    })
  })

  it('reconstructs a vector storage variable from __ and __len__ mappings', () => {
    const abi = parseAbi(BYTECODE_STORAGE_ABI)
    expect(abi.storageVariables).toContainEqual({
      name: 'items',
      type: {
        kind: 'vector',
        element: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u64' } },
      },
    })
  })

  it('filters storage mappings out of regular mappings', () => {
    const abi = parseAbi(BYTECODE_STORAGE_ABI)
    const names = abi.mappings.map((m) => m.name)
    expect(names).not.toContain('counter__')
    expect(names).not.toContain('items__')
    expect(names).not.toContain('items__len__')
  })

  it('keeps regular mappings intact', () => {
    const abi = parseAbi(BYTECODE_STORAGE_ABI)
    expect(abi.mappings).toHaveLength(1)
    expect(abi.mappings[0]!.name).toBe('scores')
  })
})

describe('parseAbi — error cases', () => {
  it('throws on non-object input', () => {
    expect(() => parseAbi('not an object')).toThrow('Invalid ABI')
  })

  it('throws on unknown Mode', () => {
    const bad = {
      ...STORAGE_VAR_ABI,
      functions: [{
        name: 'bad',
        is_final: false,
        inputs: [{ name: 'x', ty: { Plaintext: { Primitive: 'Boolean' } }, mode: 'Invalid' }],
        outputs: [],
      }],
    }
    expect(() => parseAbi(bad)).toThrow('Unknown Mode variant: Invalid')
  })

  it('throws on unknown FunctionInput variant', () => {
    const bad = {
      ...STORAGE_VAR_ABI,
      functions: [{
        name: 'bad',
        is_final: false,
        inputs: [{ name: 'x', ty: { Unknown: {} }, mode: 'None' }],
        outputs: [],
      }],
    }
    expect(() => parseAbi(bad)).toThrow('Unknown FunctionInput variant')
  })
})

describe('parseAbi — dynamic ID record variants', () => {
  const makeAbi = (inputs: unknown[], outputs: unknown[]) => ({
    program: 'dynamic.aleo',
    structs: [],
    records: [],
    mappings: [],
    storage_variables: [],
    functions: [{
      name: 'dispatch',
      is_final: false,
      inputs: inputs.map((ty, i) => ({ name: `arg${i}`, ty, mode: 'Private' })),
      outputs: outputs.map((ty) => ({ ty, mode: 'Private' })),
    }],
  })

  it('parses RecordWithDynamicId input as record with dynamicId', () => {
    const abi = parseAbi(makeAbi(
      [{ RecordWithDynamicId: { path: ['Token'], program: 'token.aleo', dynamic_id: '123field' } }],
      [],
    ))
    expect(abi.functions[0]!.inputs[0]!.type).toEqual({
      kind: 'record', path: ['Token'], program: 'token.aleo', dynamicId: '123field',
    })
  })

  it('parses ExternalRecordWithDynamicId input as record with dynamicId', () => {
    const abi = parseAbi(makeAbi(
      [{ ExternalRecordWithDynamicId: { program: 'foreign.aleo', dynamic_id: '456field' } }],
      [],
    ))
    expect(abi.functions[0]!.inputs[0]!.type).toEqual({
      kind: 'record', path: [], program: 'foreign.aleo', dynamicId: '456field',
    })
  })

  it('parses RecordWithDynamicId output as record with dynamicId', () => {
    const abi = parseAbi(makeAbi(
      [],
      [{ RecordWithDynamicId: { path: ['Token'], program: 'token.aleo', dynamic_id: '789field' } }],
    ))
    expect(abi.functions[0]!.outputs[0]!.type).toEqual({
      kind: 'record', path: ['Token'], program: 'token.aleo', dynamicId: '789field',
    })
  })

  it('parses ExternalRecordWithDynamicId output as record with dynamicId', () => {
    const abi = parseAbi(makeAbi(
      [],
      [{ ExternalRecordWithDynamicId: { program: 'foreign.aleo', dynamic_id: '101field' } }],
    ))
    expect(abi.functions[0]!.outputs[0]!.type).toEqual({
      kind: 'record', path: [], program: 'foreign.aleo', dynamicId: '101field',
    })
  })

  it('regular Record parsing unchanged (no dynamicId)', () => {
    const abi = parseAbi(makeAbi(
      [{ Record: { path: ['Token'], program: 'token.aleo' } }],
      [{ Record: { path: ['Token'], program: 'token.aleo' } }],
    ))
    expect(abi.functions[0]!.inputs[0]!.type).toEqual({
      kind: 'record', path: ['Token'], program: 'token.aleo',
    })
    expect(abi.functions[0]!.outputs[0]!.type).toEqual({
      kind: 'record', path: ['Token'], program: 'token.aleo',
    })
  })
})
