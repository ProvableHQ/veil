import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { checkProgramConformance } from '../../src/contract/arcConformance.js'

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../fixtures/programs', name), 'utf8')

const arc20Vector = fixture('test_arc20_eth.aleo')
const arc22Vector = fixture('test_usdcx_stablecoin.aleo')
const arc22Template = fixture('compliant_token_template.aleo')

describe('checkProgramConformance', () => {
  it('deployed test_arc20_eth.aleo conforms to ARC-20', () => {
    const report = checkProgramConformance(arc20Vector, 'arc20')
    expect(report.programId).toBe('test_arc20_eth.aleo')
    expect(report.violations).toEqual([])
    expect(report.conforms).toBe(true)
  })

  it('test_arc20_eth.aleo does not conform to ARC-22', () => {
    const report = checkProgramConformance(arc20Vector, 'arc22')
    expect(report.conforms).toBe(false)
  })

  it('compiled compliant_token_template.aleo conforms to ARC-22', () => {
    const report = checkProgramConformance(arc22Template, 'arc22')
    expect(report.violations).toEqual([])
    expect(report.conforms).toBe(true)
  })

  it('compliant_token_template.aleo does not conform to ARC-20', () => {
    expect(checkProgramConformance(arc22Template, 'arc20').conforms).toBe(false)
  })

  it('deployed test_usdcx_stablecoin.aleo fails ARC-22 on exactly the seven missing views', () => {
    const report = checkProgramConformance(arc22Vector, 'arc22')
    expect(report.conforms).toBe(false)
    expect(report.violations).toHaveLength(7)
    expect(new Set(report.violations.map((v) => v.kind))).toEqual(new Set(['missing_view']))
    expect(report.violations.map((v) => (v as { name: string }).name).sort()).toEqual(
      ['allowance', 'balance_of', 'decimals', 'max_supply', 'name', 'supply', 'symbol'],
    )
  })

  it('test_usdcx_stablecoin.aleo does not conform to ARC-20', () => {
    expect(checkProgramConformance(arc22Vector, 'arc20').conforms).toBe(false)
  })

  it('shape-checks a locally defined MerkleProof struct on a real vector', () => {
    // test_usdcx_stablecoin defines MerkleProof in-file; corrupting a field
    // type must surface as a violation on top of the seven missing views.
    const corrupted = arc22Vector.replace(
      'struct MerkleProof:\n    siblings as [field; 16u32];\n    leaf_index as u32;',
      'struct MerkleProof:\n    siblings as [field; 16u32];\n    leaf_index as u64;',
    )
    expect(corrupted).not.toBe(arc22Vector)
    const report = checkProgramConformance(corrupted, 'arc22')
    expect(report.violations).toContainEqual({
      kind: 'record_field_mismatch',
      record: 'MerkleProof',
      field: 'leaf_index',
      expected: 'u32',
      actual: 'u64',
    })
  })

  it('reports a missing function with its name', () => {
    const gutted = arc20Vector.replace(/function unapprove_public:/, 'function renamed_unapprove:')
    const report = checkProgramConformance(gutted, 'arc20')
    expect(report.violations).toContainEqual({ kind: 'missing_function', name: 'unapprove_public' })
  })

  it('reports a visibility flip as an input mismatch at the exact position', () => {
    const flipped = arc20Vector.replace(
      'function transfer_public:\n    input r0 as address.public;',
      'function transfer_public:\n    input r0 as address.private;',
    )
    const report = checkProgramConformance(flipped, 'arc20')
    expect(report.violations).toContainEqual({
      kind: 'input_mismatch',
      fn: 'transfer_public',
      index: 0,
      expected: 'address.public',
      actual: 'address.private',
    })
  })
})
