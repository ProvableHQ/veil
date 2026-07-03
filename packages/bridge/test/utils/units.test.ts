import { describe, it, expect } from 'vitest'
import { compareDecimal, parseDecimalAmount } from '../../src/utils/units.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'

describe('parseDecimalAmount', () => {
  it('scales whole and fractional amounts to atomic units', () => {
    expect(parseDecimalAmount('100', 6)).toBe(100_000_000n)
    expect(parseDecimalAmount('0.5', 6)).toBe(500_000n)
    expect(parseDecimalAmount('1.5', 6)).toBe(1_500_000n)
    expect(parseDecimalAmount('0.01', 8)).toBe(1_000_000n)
  })

  it('is exact where floats are not (18-decimal assets)', () => {
    expect(parseDecimalAmount('1.000000000000000001', 18)).toBe(1_000_000_000_000_000_001n)
  })

  it('handles zero-decimal assets and full precision', () => {
    expect(parseDecimalAmount('42', 0)).toBe(42n)
    expect(parseDecimalAmount('0.123456', 6)).toBe(123_456n)
  })

  it('rejects more fractional digits than the asset supports', () => {
    expect(() => parseDecimalAmount('0.1234567', 6)).toThrow(BridgeError)
  })

  it('rejects non-decimal input', () => {
    expect(() => parseDecimalAmount('1e6', 6)).toThrow(BridgeError)
    expect(() => parseDecimalAmount('-1', 6)).toThrow(BridgeError)
    expect(() => parseDecimalAmount('1.', 6)).toThrow(BridgeError)
    expect(() => parseDecimalAmount('', 6)).toThrow(BridgeError)
  })
})

describe('compareDecimal', () => {
  it('orders plain decimals', () => {
    expect(compareDecimal('1.5', '2')).toBeLessThan(0)
    expect(compareDecimal('2', '1.5')).toBeGreaterThan(0)
    expect(compareDecimal('2.0', '2')).toBe(0)
  })

  it('is exact where Number() is not (18 decimals)', () => {
    expect(compareDecimal('1.000000000000000002', '1.000000000000000001')).toBeGreaterThan(0)
    expect(compareDecimal('1.000000000000000001', '1.000000000000000002')).toBeLessThan(0)
  })

  it('treats malformed input as equal rather than throwing', () => {
    expect(compareDecimal('abc', '1')).toBe(0)
    expect(compareDecimal('1', '')).toBe(0)
  })
})
