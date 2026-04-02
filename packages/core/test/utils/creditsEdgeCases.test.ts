import { describe, it, expect } from 'vitest'
import { creditsToMicrocredits, microcreditsToCredits } from '../../src/utils/credits.js'

describe('creditsToMicrocredits edge cases', () => {
  it('converts 0 credits (bigint)', () => {
    expect(creditsToMicrocredits(0n)).toBe(0n)
  })

  it('converts 1 credit (bigint)', () => {
    expect(creditsToMicrocredits(1n)).toBe(1_000_000n)
  })

  it('converts large amount (bigint)', () => {
    expect(creditsToMicrocredits(1_000_000n)).toBe(1_000_000_000_000n)
  })

  it('converts 0 credits (number)', () => {
    expect(creditsToMicrocredits(0)).toBe(0n)
  })

  it('converts 1 credit (number)', () => {
    expect(creditsToMicrocredits(1)).toBe(1_000_000n)
  })

  it('converts fractional credits (number)', () => {
    expect(creditsToMicrocredits(0.5)).toBe(500_000n)
    expect(creditsToMicrocredits(0.1)).toBe(100_000n)
    expect(creditsToMicrocredits(1.5)).toBe(1_500_000n)
    expect(creditsToMicrocredits(0.000001)).toBe(1n)
  })

  it('rounds fractional microcredits', () => {
    // 0.0000005 credits = 0.5 microcredits, should round to 1
    expect(creditsToMicrocredits(0.0000005)).toBe(1n)
    // 0.0000004 credits = 0.4 microcredits, should round to 0
    expect(creditsToMicrocredits(0.0000004)).toBe(0n)
  })

  it('handles very small amounts (number)', () => {
    expect(creditsToMicrocredits(0.000001)).toBe(1n) // 1 microcredit
  })
})

describe('microcreditsToCredits edge cases', () => {
  it('converts 0 microcredits', () => {
    expect(microcreditsToCredits(0n)).toBe(0)
  })

  it('converts 1 microcredit', () => {
    expect(microcreditsToCredits(1n)).toBe(0.000001)
  })

  it('converts 1_000_000 microcredits', () => {
    expect(microcreditsToCredits(1_000_000n)).toBe(1)
  })

  it('converts 500_000 microcredits', () => {
    expect(microcreditsToCredits(500_000n)).toBe(0.5)
  })

  it('converts large amounts', () => {
    expect(microcreditsToCredits(1_000_000_000_000n)).toBe(1_000_000)
  })

  it('handles 100_000 microcredits', () => {
    expect(microcreditsToCredits(100_000n)).toBe(0.1)
  })
})
