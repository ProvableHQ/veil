import { describe, it, expect } from 'vitest'
import { creditsToMicrocredits, microcreditsToCredits } from '../../src/utils/credits.js'

describe('creditsToMicrocredits', () => {
  it('converts 1 credit to 1_000_000 microcredits', () => {
    expect(creditsToMicrocredits(1n)).toBe(1_000_000n)
  })

  it('converts 0 credits', () => {
    expect(creditsToMicrocredits(0n)).toBe(0n)
  })

  it('converts fractional credits from number', () => {
    expect(creditsToMicrocredits(1.5)).toBe(1_500_000n)
  })
})

describe('microcreditsToCredits', () => {
  it('converts 1_000_000 microcredits to 1', () => {
    expect(microcreditsToCredits(1_000_000n)).toBe(1)
  })

  it('converts 500_000 microcredits to 0.5', () => {
    expect(microcreditsToCredits(500_000n)).toBe(0.5)
  })
})
