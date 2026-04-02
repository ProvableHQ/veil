import { describe, it, expect } from 'vitest'
import { isAddress, assertAddress } from '../../src/utils/address.js'

describe('isAddress', () => {
  it('returns true for valid aleo address', () => {
    expect(isAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isAddress('')).toBe(false)
  })

  it('returns false for ethereum address', () => {
    expect(isAddress('0xA0Cf798816D4b9b9866b5330EEa46a18382f251e')).toBe(false)
  })

  it('returns false for missing aleo1 prefix', () => {
    expect(isAddress('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(false)
  })
})

describe('assertAddress', () => {
  it('throws for invalid address', () => {
    expect(() => assertAddress('bad')).toThrow()
  })

  it('does not throw for valid address', () => {
    expect(() => assertAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).not.toThrow()
  })
})
