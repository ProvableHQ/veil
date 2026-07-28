import { describe, it, expect } from 'vitest'
import { parseValue, encodeValue } from '../../src/utils/values.js'

describe('parseValue', () => {
  it('parses u64 values', () => {
    expect(parseValue('100u64')).toEqual({ value: 100n, type: 'u64' })
  })

  it('parses u128 values', () => {
    expect(parseValue('999u128')).toEqual({ value: 999n, type: 'u128' })
  })

  it('parses field values', () => {
    expect(parseValue('42field')).toEqual({ value: 42n, type: 'field' })
  })

  it('parses boolean values', () => {
    expect(parseValue('true')).toEqual({ value: true, type: 'boolean' })
    expect(parseValue('false')).toEqual({ value: false, type: 'boolean' })
  })

  it('parses address values', () => {
    const addr = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
    expect(parseValue(addr)).toEqual({ value: addr, type: 'address' })
  })

  it('parses signature values', () => {
    const sig = 'sign1nnrfycmcnrtnfyyxtx87mfw6cd6r82p22vs2gwvkxqqvpe0jyqqzk5zqy'
    expect(parseValue(sig)).toEqual({ value: sig, type: 'signature' })
  })

  it('does not parse identifier literals — bare tokens stay unrecognized', () => {
    expect(() => parseValue('some_identifier')).toThrow('Cannot parse value: some_identifier')
  })

  it('throws on unrecognized formats', () => {
    expect(() => parseValue('unknown')).toThrow('Cannot parse value: unknown')
  })
})

describe('encodeValue', () => {
  it('encodes bigint with type suffix', () => {
    expect(encodeValue(100n, 'u64')).toBe('100u64')
  })

  it('encodes boolean', () => {
    expect(encodeValue(true, 'boolean')).toBe('true')
  })
})
