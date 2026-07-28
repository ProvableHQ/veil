import { describe, it, expect } from 'vitest'
import { encodePlaintextValue, encodeInputs, parseRecord } from '../../src/utils/records.js'
import type { ABI } from '../../src/types/abi.js'
import type { Plaintext } from '../../src/types/primitives.js'

// Minimal ABI carrying the struct shapes the new shield_swap stack uses.
const abi: ABI = {
  program: 'shield_swap.aleo',
  structs: [
    {
      path: ['MerkleProof'],
      fields: [
        {
          name: 'siblings',
          type: { kind: 'array', element: { kind: 'primitive', primitive: 'field' }, length: 16 },
        },
        { name: 'leaf_index', type: { kind: 'primitive', primitive: 'u32' } },
      ],
    },
    {
      path: ['U256'],
      fields: [
        { name: 'hi', type: { kind: 'primitive', primitive: 'u128' } },
        { name: 'lo', type: { kind: 'primitive', primitive: 'u128' } },
      ],
    },
  ],
  records: [],
  mappings: [],
  storageVariables: [],
  functions: [
    {
      name: 'prove',
      isFinal: false,
      inputs: [
        {
          name: 'proofs',
          type: {
            kind: 'plaintext',
            type: {
              kind: 'array',
              element: { kind: 'struct', path: ['MerkleProof'] },
              length: 2,
            },
          },
          mode: 'private',
        },
      ],
      outputs: [],
    },
  ],
}

const u256: Plaintext = { kind: 'struct', path: ['U256'] }
const merkleArray: Plaintext = {
  kind: 'array',
  element: { kind: 'struct', path: ['MerkleProof'] },
  length: 2,
}

const emptyProof = { siblings: Array(16).fill('0field'), leaf_index: 1 }

describe('encodePlaintextValue', () => {
  it('encodes a struct from a plain object', () => {
    expect(encodePlaintextValue({ hi: 1n, lo: 0n }, u256, abi)).toBe('{ hi: 1u128, lo: 0u128 }')
  })

  it('encodes an array of structs with nested arrays', () => {
    const encoded = encodePlaintextValue([emptyProof, emptyProof], merkleArray, abi)
    const one = `{ siblings: [${Array(16).fill('0field').join(', ')}], leaf_index: 1u32 }`
    expect(encoded).toBe(`[${one}, ${one}]`)
  })

  it('encodes nested primitive arrays with element suffixes', () => {
    const grid: Plaintext = {
      kind: 'array',
      element: { kind: 'array', element: { kind: 'primitive', primitive: 'u8' }, length: 2 },
      length: 2,
    }
    expect(encodePlaintextValue([[1n, 2], [3, 4n]], grid, abi)).toBe('[[1u8, 2u8], [3u8, 4u8]]')
  })

  it('passes pre-encoded strings through at any nesting level', () => {
    expect(encodePlaintextValue('{ hi: 1u128, lo: 0u128 }', u256, abi)).toBe('{ hi: 1u128, lo: 0u128 }')
    expect(encodePlaintextValue(['{ x: 1u8 }', emptyProof], merkleArray, abi)).toContain('{ x: 1u8 }')
  })

  it('rejects a struct value when no ABI carries the definition', () => {
    expect(() => encodePlaintextValue({ hi: 1n, lo: 0n }, u256)).toThrow(/struct/i)
  })

  it('rejects a struct object missing a declared field', () => {
    expect(() => encodePlaintextValue({ hi: 1n }, u256, abi)).toThrow(/lo/)
  })

  it('rejects wrong-arity arrays', () => {
    expect(() => encodePlaintextValue([emptyProof], merkleArray, abi)).toThrow(/length/i)
  })
})

describe('encodeInputs with composite values', () => {
  it('encodes an array-of-structs input against the ABI', () => {
    const encoded = encodeInputs([[emptyProof, emptyProof]], abi, 'prove')
    expect(encoded).toHaveLength(1)
    expect(encoded[0]).toContain('leaf_index: 1u32')
    expect(encoded[0]!.startsWith('[{ siblings: [0field')).toBe(true)
  })
})

describe('record parsing with array-valued fields', () => {
  it('splits fields bracket-aware and parses array values', () => {
    const record = parseRecord(
      '{ owner: aleo1abc.private, siblings: [1field, 2field].private, amount: 5u64.private, _nonce: 7group.public }',
      { program: 'p.aleo', recordName: 'R' },
    )
    expect(record.fields.amount!.value).toBe(5n)
    expect(record.fields.siblings!.value).toEqual([1n, 2n])
  })

  it('parses nested struct values inside records', () => {
    const record = parseRecord(
      '{ owner: aleo1abc.private, limit: { hi: 1u128, lo: 0u128 }.private, _nonce: 7group.public }',
      { program: 'p.aleo', recordName: 'R' },
    )
    expect(record.fields.limit!.value).toEqual({ hi: 1n, lo: 0n })
  })
})
