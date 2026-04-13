import { describe, it, expect } from 'vitest'
import { parsePrimitive, parsePlaintext } from '../../src/utils/parsePrimitives.js'

// Primitive types from the tictactoe and storage_var ABI outputs

describe('parsePrimitive', () => {
  it('parses unit variants (no data)', () => {
    expect(parsePrimitive('Address')).toBe('address')
    expect(parsePrimitive('Boolean')).toBe('boolean')
    expect(parsePrimitive('Field')).toBe('field')
    expect(parsePrimitive('Group')).toBe('group')
    expect(parsePrimitive('Scalar')).toBe('scalar')
    expect(parsePrimitive('Signature')).toBe('signature')
    expect(parsePrimitive('Identifier')).toBe('identifier')
  })

  it('parses UInt variants', () => {
    expect(parsePrimitive({ UInt: 'U8' })).toBe('u8')
    expect(parsePrimitive({ UInt: 'U16' })).toBe('u16')
    expect(parsePrimitive({ UInt: 'U32' })).toBe('u32')
    expect(parsePrimitive({ UInt: 'U64' })).toBe('u64')
    expect(parsePrimitive({ UInt: 'U128' })).toBe('u128')
  })

  it('parses Int variants', () => {
    expect(parsePrimitive({ Int: 'I8' })).toBe('i8')
    expect(parsePrimitive({ Int: 'I16' })).toBe('i16')
    expect(parsePrimitive({ Int: 'I32' })).toBe('i32')
    expect(parsePrimitive({ Int: 'I64' })).toBe('i64')
    expect(parsePrimitive({ Int: 'I128' })).toBe('i128')
  })

  it('throws on unknown variants', () => {
    expect(() => parsePrimitive('Unknown')).toThrow('Unknown Primitive variant: Unknown')
    expect(() => parsePrimitive({ UInt: 'U999' })).toThrow('Unknown UInt variant: U999')
  })
})

describe('parsePlaintext', () => {
  // From tictactoe ABI: { "Primitive": { "UInt": "U8" } }
  it('parses primitive plaintext', () => {
    expect(parsePlaintext({ Primitive: { UInt: 'U8' } })).toEqual({
      kind: 'primitive',
      primitive: 'u8',
    })
  })

  // From tictactoe ABI: Board.r1 field type
  it('parses struct reference', () => {
    expect(parsePlaintext({ Struct: { path: ['Row'], program: 'tictactoe.aleo' } })).toEqual({
      kind: 'struct',
      path: ['Row'],
      program: 'tictactoe.aleo',
    })
  })

  // From storage_var ABI: { "Primitive": { "UInt": "U32" } }
  it('parses u32 primitive from storage_var', () => {
    expect(parsePlaintext({ Primitive: { UInt: 'U32' } })).toEqual({
      kind: 'primitive',
      primitive: 'u32',
    })
  })

  it('parses array plaintext', () => {
    expect(parsePlaintext({ Array: { element: { Primitive: 'Boolean' }, length: 4 } })).toEqual({
      kind: 'array',
      element: { kind: 'primitive', primitive: 'boolean' },
      length: 4,
    })
  })

  it('parses optional plaintext', () => {
    expect(parsePlaintext({ Optional: { Primitive: { UInt: 'U64' } } })).toEqual({
      kind: 'optional',
      inner: { kind: 'primitive', primitive: 'u64' },
    })
  })

  it('throws on unknown variants', () => {
    expect(() => parsePlaintext({ Unknown: {} })).toThrow('Unknown Plaintext variant')
    expect(() => parsePlaintext('not an object')).toThrow('Invalid Plaintext')
  })
})
