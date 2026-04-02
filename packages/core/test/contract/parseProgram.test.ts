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
    expect(transfer.inputs[0]).toEqual({ name: 'r0', type: 'address', visibility: 'public' })
    expect(transfer.inputs[1]).toEqual({ name: 'r1', type: 'u64', visibility: 'public' })
    expect(transfer.outputs).toHaveLength(1)
    expect(transfer.outputs[0]).toEqual({ type: 'u64', visibility: 'public' })
    expect(transfer.hasFinalize).toBe(true)

    const mint = program.functions.find(f => f.name === 'mint')!
    expect(mint.inputs[0]).toEqual({ name: 'r0', type: 'u64', visibility: 'private' })
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
