import { describe, it, expect } from 'vitest'
import { parseValue, encodeValue } from '../../src/utils/values.js'

describe('parseValue edge cases', () => {
  // Unsigned integer types
  it('parses u8 values', () => {
    expect(parseValue('255u8')).toEqual({ value: 255n, type: 'u8' })
  })

  it('parses u16 values', () => {
    expect(parseValue('65535u16')).toEqual({ value: 65535n, type: 'u16' })
  })

  it('parses u32 values', () => {
    expect(parseValue('4294967295u32')).toEqual({ value: 4294967295n, type: 'u32' })
  })

  it('parses u64 values', () => {
    expect(parseValue('18446744073709551615u64')).toEqual({
      value: 18446744073709551615n,
      type: 'u64',
    })
  })

  it('parses u128 values', () => {
    expect(parseValue('340282366920938463463374607431768211455u128')).toEqual({
      value: 340282366920938463463374607431768211455n,
      type: 'u128',
    })
  })

  // Signed integer types
  it('parses i8 values', () => {
    expect(parseValue('-128i8')).toEqual({ value: -128n, type: 'i8' })
    expect(parseValue('127i8')).toEqual({ value: 127n, type: 'i8' })
  })

  it('parses i16 values', () => {
    expect(parseValue('-32768i16')).toEqual({ value: -32768n, type: 'i16' })
  })

  it('parses i32 values', () => {
    expect(parseValue('-2147483648i32')).toEqual({ value: -2147483648n, type: 'i32' })
  })

  it('parses i64 values', () => {
    expect(parseValue('-9223372036854775808i64')).toEqual({
      value: -9223372036854775808n,
      type: 'i64',
    })
  })

  it('parses i128 values', () => {
    expect(parseValue('-170141183460469231731687303715884105728i128')).toEqual({
      value: -170141183460469231731687303715884105728n,
      type: 'i128',
    })
  })

  // Field, scalar, group
  it('parses field values', () => {
    expect(parseValue('42field')).toEqual({ value: 42n, type: 'field' })
    expect(parseValue('0field')).toEqual({ value: 0n, type: 'field' })
  })

  it('parses scalar values', () => {
    expect(parseValue('7scalar')).toEqual({ value: 7n, type: 'scalar' })
  })

  it('parses group values', () => {
    expect(parseValue('3group')).toEqual({ value: 3n, type: 'group' })
  })

  // Address
  it('parses address values', () => {
    const addr = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
    expect(parseValue(addr)).toEqual({ value: addr, type: 'address' })
  })

  // Boolean
  it('parses true', () => {
    expect(parseValue('true')).toEqual({ value: true, type: 'boolean' })
  })

  it('parses false', () => {
    expect(parseValue('false')).toEqual({ value: false, type: 'boolean' })
  })

  // Zero values
  it('parses zero for all numeric types', () => {
    expect(parseValue('0u8')).toEqual({ value: 0n, type: 'u8' })
    expect(parseValue('0u16')).toEqual({ value: 0n, type: 'u16' })
    expect(parseValue('0u32')).toEqual({ value: 0n, type: 'u32' })
    expect(parseValue('0u64')).toEqual({ value: 0n, type: 'u64' })
    expect(parseValue('0u128')).toEqual({ value: 0n, type: 'u128' })
    expect(parseValue('0i8')).toEqual({ value: 0n, type: 'i8' })
    expect(parseValue('0i16')).toEqual({ value: 0n, type: 'i16' })
    expect(parseValue('0i32')).toEqual({ value: 0n, type: 'i32' })
    expect(parseValue('0i64')).toEqual({ value: 0n, type: 'i64' })
    expect(parseValue('0i128')).toEqual({ value: 0n, type: 'i128' })
    expect(parseValue('0field')).toEqual({ value: 0n, type: 'field' })
    expect(parseValue('0scalar')).toEqual({ value: 0n, type: 'scalar' })
    expect(parseValue('0group')).toEqual({ value: 0n, type: 'group' })
  })

  // Unrecognized
  it('returns string for unrecognized formats', () => {
    expect(parseValue('hello')).toEqual({ value: 'hello', type: 'string' })
    expect(parseValue('')).toEqual({ value: '', type: 'string' })
    expect(parseValue('123')).toEqual({ value: '123', type: 'string' }) // no type suffix
  })
})

describe('encodeValue edge cases', () => {
  it('encodes all unsigned integer types', () => {
    expect(encodeValue(255n, 'u8')).toBe('255u8')
    expect(encodeValue(65535n, 'u16')).toBe('65535u16')
    expect(encodeValue(4294967295n, 'u32')).toBe('4294967295u32')
    expect(encodeValue(18446744073709551615n, 'u64')).toBe('18446744073709551615u64')
    expect(encodeValue(340282366920938463463374607431768211455n, 'u128'))
      .toBe('340282366920938463463374607431768211455u128')
  })

  it('encodes all signed integer types', () => {
    expect(encodeValue(-128n, 'i8')).toBe('-128i8')
    expect(encodeValue(127n, 'i8')).toBe('127i8')
    expect(encodeValue(-32768n, 'i16')).toBe('-32768i16')
    expect(encodeValue(-2147483648n, 'i32')).toBe('-2147483648i32')
    expect(encodeValue(-9223372036854775808n, 'i64')).toBe('-9223372036854775808i64')
  })

  it('encodes field, scalar, group', () => {
    expect(encodeValue(42n, 'field')).toBe('42field')
    expect(encodeValue(7n, 'scalar')).toBe('7scalar')
    expect(encodeValue(3n, 'group')).toBe('3group')
  })

  it('encodes boolean', () => {
    expect(encodeValue(true, 'boolean')).toBe('true')
    expect(encodeValue(false, 'boolean')).toBe('false')
  })

  it('encodes address', () => {
    const addr = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
    expect(encodeValue(addr, 'address')).toBe(addr)
  })

  it('encodes string type', () => {
    expect(encodeValue('hello', 'string')).toBe('hello')
  })
})

describe('parseValue -> encodeValue roundtrip', () => {
  const roundtripCases = [
    '100u8',
    '65535u16',
    '1000u32',
    '999999u64',
    '340282366920938463463374607431768211455u128',
    '-128i8',
    '127i8',
    '-32768i16',
    '0i32',
    '-9223372036854775808i64',
    '42field',
    '7scalar',
    '3group',
  ]

  for (const input of roundtripCases) {
    it(`roundtrips ${input}`, () => {
      const parsed = parseValue(input)
      const encoded = encodeValue(parsed.value, parsed.type)
      expect(encoded).toBe(input)
    })
  }

  it('roundtrips boolean true', () => {
    const parsed = parseValue('true')
    const encoded = encodeValue(parsed.value, parsed.type)
    expect(encoded).toBe('true')
  })

  it('roundtrips boolean false', () => {
    const parsed = parseValue('false')
    const encoded = encodeValue(parsed.value, parsed.type)
    expect(encoded).toBe('false')
  })
})
