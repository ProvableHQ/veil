import { describe, it, expect } from 'vitest'
import { parseUnits, formatUnits } from '../../src/utils/units.js'

describe('parseUnits', () => {
  it('scales decimals to base units', () => {
    expect(parseUnits('1.5', 6)).toBe(1_500_000n)
    expect(parseUnits('1', 6)).toBe(1_000_000n)
    expect(parseUnits('0.000001', 6)).toBe(1n)
    expect(parseUnits('0', 6)).toBe(0n)
    expect(parseUnits('42', 0)).toBe(42n)
  })

  it('keeps 18 significant decimals a double would lose', () => {
    // The exact string the DEX API returned for an ETH quote, which is what
    // pushed this helper into existence: BigInt() throws on it and Number()
    // rounds it.
    expect(parseUnits('1.030419082712717843', 18)).toBe(1_030_419_082_712_717_843n)
    expect(Number('1.030419082712717843') * 1e18).not.toBe(1_030_419_082_712_717_843)
  })

  it('accepts the shapes people and APIs actually write', () => {
    expect(parseUnits('  1.5  ', 6)).toBe(1_500_000n)
    expect(parseUnits('1.', 6)).toBe(1_000_000n)
    expect(parseUnits('.5', 6)).toBe(500_000n)
  })

  it('refuses to silently drop digits the token cannot hold', () => {
    // Truncating here would move money the caller did not intend, so it is an
    // error rather than a rounding.
    expect(() => parseUnits('1.1234567', 6)).toThrow(/7 decimal places but this token has 6/)
  })

  it('refuses anything that is not a non-negative decimal', () => {
    for (const bad of ['-1', '1e6', 'abc', '', '.', '1.2.3', '1,5']) {
      expect(() => parseUnits(bad, 6), bad).toThrow(/not a non-negative decimal/)
    }
  })
})

describe('formatUnits', () => {
  it('renders base units without trailing zeros', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5')
    expect(formatUnits(1_000_000n, 6)).toBe('1')
    expect(formatUnits(1n, 6)).toBe('0.000001')
    expect(formatUnits(0n, 6)).toBe('0')
    expect(formatUnits(42n, 0)).toBe('42')
  })

  it('round-trips with parseUnits at 18 decimals', () => {
    for (const value of ['1.030419082712717843', '0.000000000000000001', '12345.6789']) {
      expect(formatUnits(parseUnits(value, 18), 18)).toBe(value)
    }
  })

  it('pads a value smaller than one whole unit', () => {
    expect(formatUnits(37_459_421_702_974_736n, 18)).toBe('0.037459421702974736')
  })
})
