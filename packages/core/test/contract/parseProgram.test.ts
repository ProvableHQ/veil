import { describe, it, expect } from 'vitest'
import { parseProgram } from '../../src/contract/parseProgram.js'

describe('parseProgram', () => {
  const TOKEN_SOURCE = `program token.aleo;

mapping balances:
    key as address.public;
    value as u64.public;

mapping approvals:
    key as field.public;
    value as boolean.public;

function transfer:
    input r0 as address.public;
    input r1 as u64.public;
    output r2 as u64.public;

finalize transfer:
    input r0 as address.public;
    input r1 as u64.public;

function mint:
    input r0 as u64.private;

closure helper:
    input r0 as u64;
`

  it('extracts program id', () => {
    const program = parseProgram(TOKEN_SOURCE)
    expect(program.id).toBe('token.aleo')
  })

  it('extracts functions with inputs and outputs', () => {
    const program = parseProgram(TOKEN_SOURCE)
    const names = program.functions.map(f => f.name)
    expect(names).toContain('transfer')
    expect(names).toContain('mint')

    const transfer = program.functions.find(f => f.name === 'transfer')!
    expect(transfer.inputs).toHaveLength(2)
    expect(transfer.inputs[0]).toEqual({ kind: 'plaintext', name: 'r0', type: 'address', visibility: 'public' })
    expect(transfer.inputs[1]).toEqual({ kind: 'plaintext', name: 'r1', type: 'u64', visibility: 'public' })
    expect(transfer.outputs).toHaveLength(1)
    expect(transfer.outputs[0]).toEqual({ kind: 'plaintext', type: 'u64', visibility: 'public' })
    expect(transfer.hasFinalize).toBe(true)

    const mint = program.functions.find(f => f.name === 'mint')!
    expect(mint.inputs[0]).toEqual({ kind: 'plaintext', name: 'r0', type: 'u64', visibility: 'private' })
    expect(mint.hasFinalize).toBe(false)
  })

  it('extracts mappings with key/value types', () => {
    const program = parseProgram(TOKEN_SOURCE)
    expect(program.mappings).toHaveLength(2)

    const balances = program.mappings.find(m => m.name === 'balances')!
    expect(balances.keyType).toBe('address')
    expect(balances.valueType).toBe('u64')

    const approvals = program.mappings.find(m => m.name === 'approvals')!
    expect(approvals.keyType).toBe('field')
    expect(approvals.valueType).toBe('boolean')
  })

  it('extracts closures', () => {
    const program = parseProgram(TOKEN_SOURCE)
    expect(program.closures).toContain('helper')
  })

  it('preserves full source', () => {
    const program = parseProgram(TOKEN_SOURCE)
    expect(program.source).toBe(TOKEN_SOURCE)
  })

  it('handles minimal program', () => {
    const program = parseProgram('program test.aleo;\n')
    expect(program.id).toBe('test.aleo')
    expect(program.functions).toHaveLength(0)
    expect(program.mappings).toHaveLength(0)
    expect(program.closures).toHaveLength(0)
  })
})

describe('parseProgram — records, structs, views, register types', () => {
  const source = `import freezelist.aleo;
program conformance_fixture.aleo;

record Token:
    owner as address.private;
    amount as u128.private;

struct MerkleProof:
    siblings as [field; 16u32];
    leaf_index as u32;

function transfer_private:
    input r0 as address.private;
    input r1 as u128.private;
    input r2 as Token.record;
    input r3 as [freezelist.aleo/MerkleProof; 2u32].private;
    async transfer_private r0 r1 into r4;
    output r5 as Token.record;
    output r4 as conformance_fixture.aleo/transfer_private.future;

view name:
    output 'ETH' as identifier.public;

view balance_of:
    input r0 as address.public;
    output r1 as u128.public;
`

  it('parses record declarations with field visibility', () => {
    const program = parseProgram(source)
    expect(program.records).toEqual([
      {
        name: 'Token',
        fields: [
          { name: 'owner', type: 'address', visibility: 'private' },
          { name: 'amount', type: 'u128', visibility: 'private' },
        ],
      },
    ])
  })

  it('parses struct declarations including array field types', () => {
    const program = parseProgram(source)
    expect(program.structs).toEqual([
      {
        name: 'MerkleProof',
        fields: [
          { name: 'siblings', type: '[field; 16u32]' },
          { name: 'leaf_index', type: 'u32' },
        ],
      },
    ])
  })

  it('parses record, array, and future register types in functions', () => {
    const program = parseProgram(source)
    const fn = program.functions.find((f) => f.name === 'transfer_private')!
    expect(fn.inputs).toEqual([
      { kind: 'plaintext', name: 'r0', type: 'address', visibility: 'private' },
      { kind: 'plaintext', name: 'r1', type: 'u128', visibility: 'private' },
      { kind: 'record', name: 'r2', type: 'Token' },
      { kind: 'plaintext', name: 'r3', type: '[freezelist.aleo/MerkleProof; 2u32]', visibility: 'private' },
    ])
    expect(fn.outputs).toEqual([
      { kind: 'record', type: 'Token' },
      { kind: 'future', type: 'conformance_fixture.aleo/transfer_private' },
    ])
  })

  it('parses view blocks like functions, including literal outputs', () => {
    const program = parseProgram(source)
    expect(program.views.map((v) => v.name)).toEqual(['name', 'balance_of'])
    const name = program.views.find((v) => v.name === 'name')!
    expect(name.inputs).toEqual([])
    expect(name.outputs).toEqual([{ kind: 'plaintext', type: 'identifier', visibility: 'public' }])
  })

  it('function block parsing stops at view/record/struct boundaries', () => {
    const program = parseProgram(source)
    // transfer_private must not swallow the view blocks that follow it
    expect(program.functions).toHaveLength(1)
  })
})

describe('parseProgram — full snarkVM ValueType register surface', () => {
  // One register per ValueType variant: constant, public, private, record,
  // external record, future, dynamic record, dynamic future.
  const source = `program value_types.aleo;

function kitchen_sink:
    input r0 as u8.constant;
    input r1 as address.public;
    input r2 as u128.private;
    input r3 as Token.record;
    input r4 as credits.aleo/credits.record;
    input r5 as dynamic.record;
    output r6 as u8.constant;
    output r7 as Token.record;
    output r8 as credits.aleo/credits.record;
    output r9 as dynamic.record;
    output r10 as value_types.aleo/kitchen_sink.future;
    output r11 as dynamic.future;
`

  it('parses every input variant', () => {
    const fn = parseProgram(source).functions[0]!
    expect(fn.inputs).toEqual([
      { kind: 'plaintext', name: 'r0', type: 'u8', visibility: 'constant' },
      { kind: 'plaintext', name: 'r1', type: 'address', visibility: 'public' },
      { kind: 'plaintext', name: 'r2', type: 'u128', visibility: 'private' },
      { kind: 'record', name: 'r3', type: 'Token' },
      { kind: 'record', name: 'r4', type: 'credits.aleo/credits' },
      { kind: 'dynamicRecord', name: 'r5' },
    ])
  })

  it('parses every output variant', () => {
    const fn = parseProgram(source).functions[0]!
    expect(fn.outputs).toEqual([
      { kind: 'plaintext', type: 'u8', visibility: 'constant' },
      { kind: 'record', type: 'Token' },
      { kind: 'record', type: 'credits.aleo/credits' },
      { kind: 'dynamicRecord' },
      { kind: 'future', type: 'value_types.aleo/kitchen_sink' },
      { kind: 'dynamicFuture' },
    ])
  })

  it('parses nested array and external struct plaintext types', () => {
    const program = parseProgram(`program plaintext_types.aleo;

struct Matrix:
    rows as [[field; 2u32]; 3u32];

function plaintexts:
    input r0 as [[field; 2u32]; 3u32].private;
    input r1 as credits.aleo/metadata.public;
    input r2 as Matrix.private;
    output r3 as [[u8; 4u32]; 2u32].public;
`)
    const fn = program.functions[0]!
    expect(fn.inputs).toEqual([
      { kind: 'plaintext', name: 'r0', type: '[[field; 2u32]; 3u32]', visibility: 'private' },
      { kind: 'plaintext', name: 'r1', type: 'credits.aleo/metadata', visibility: 'public' },
      { kind: 'plaintext', name: 'r2', type: 'Matrix', visibility: 'private' },
    ])
    expect(fn.outputs).toEqual([{ kind: 'plaintext', type: '[[u8; 4u32]; 2u32]', visibility: 'public' }])
    expect(program.structs).toEqual([
      { name: 'Matrix', fields: [{ name: 'rows', type: '[[field; 2u32]; 3u32]' }] },
    ])
  })

  it('parses record entries with public owner and constant entry visibility', () => {
    const program = parseProgram(`program entry_types.aleo;

record PublicToken:
    owner as address.public;
    amount as u128.private;
    decimals as u8.constant;
`)
    expect(program.records).toEqual([
      {
        name: 'PublicToken',
        fields: [
          { name: 'owner', type: 'address', visibility: 'public' },
          { name: 'amount', type: 'u128', visibility: 'private' },
          { name: 'decimals', type: 'u8', visibility: 'constant' },
        ],
      },
    ])
  })
})
