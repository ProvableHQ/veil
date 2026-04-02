import { describe, it, expect } from 'vitest'
import { isAddress, assertAddress } from '../../src/utils/address.js'
import { InvalidAddressError } from '../../src/errors/errors.js'

describe('isAddress edge cases', () => {
  // Valid addresses
  it('accepts valid address with all lowercase alphanumeric', () => {
    expect(isAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(true)
  })

  it('accepts address with mixed alphanumeric characters', () => {
    // aleo1 prefix (5 chars) + 58 lowercase alphanumeric chars = 63 total
    const addr = 'aleo1' + 'abcdef0123456789'.repeat(4).slice(0, 58)
    expect(addr.length).toBe(63)
    expect(isAddress(addr)).toBe(true)
  })

  // Invalid addresses
  it('rejects empty string', () => {
    expect(isAddress('')).toBe(false)
  })

  it('rejects ethereum address', () => {
    expect(isAddress('0xA0Cf798816D4b9b9866b5330EEa46a18382f251e')).toBe(false)
  })

  it('rejects address without aleo1 prefix', () => {
    expect(isAddress('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toBe(false)
  })

  it('rejects address with uppercase letters', () => {
    expect(isAddress('aleo1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ3ljyzc')).toBe(false)
  })

  it('rejects address that is too short', () => {
    expect(isAddress('aleo1abc')).toBe(false)
  })

  it('rejects address that is too long', () => {
    expect(isAddress('aleo1' + 'a'.repeat(59))).toBe(false)
  })

  it('rejects address with special characters', () => {
    expect(isAddress('aleo1!@#$%^&*()_+=-[]{}|;:,.<>?/~`' + 'a'.repeat(28))).toBe(false)
  })

  it('rejects address with spaces', () => {
    expect(isAddress('aleo1 qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(false)
  })

  it('rejects just the prefix', () => {
    expect(isAddress('aleo1')).toBe(false)
  })

  it('rejects bitcoin address', () => {
    expect(isAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false)
  })

  it('rejects null-like inputs', () => {
    expect(isAddress('null')).toBe(false)
    expect(isAddress('undefined')).toBe(false)
  })
})

describe('assertAddress edge cases', () => {
  it('does not throw for valid address', () => {
    expect(() => assertAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).not.toThrow()
  })

  it('throws InvalidAddressError for invalid address', () => {
    expect(() => assertAddress('bad')).toThrow(InvalidAddressError)
  })

  it('thrown error includes the bad address', () => {
    try {
      assertAddress('0xbadaddr')
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).toContain('0xbadaddr')
      expect(err.message).toContain('aleo1')
    }
  })

  it('thrown error includes format hint', () => {
    try {
      assertAddress('bad_address')
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).toContain('58')
      expect(err.message).toContain('aleo1')
    }
  })
})
