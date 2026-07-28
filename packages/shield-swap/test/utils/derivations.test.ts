import { describe, it, expect } from 'vitest'
import { poolPrice, priceImpact, portfolioValue, feeAprEstimate } from '../../src/utils/derivations.js'
import { Q128 } from '../../src/utils/q128.js'

// Q128.128 raw-unit pool fixtures. sqrt_price encodes sqrt(token1_raw/token0_raw).
// An ~2-USDC(6)/ETH(18) pool: normalized ≈ 2e-12, shift 10^(18−6).
const LIVE_SLOT = { sqrt_price: 481231938336008987585635023847424n, liquidity: 1_000_000_000_000n }

describe('poolPrice', () => {
  it('price 1.0 at tick 0 for same-decimals tokens', () => {
    const { price1Per0, price0Per1 } = poolPrice({ slot: { sqrt_price: Q128 }, decimals0: 6, decimals1: 6 })
    expect(price1Per0).toBeCloseTo(1, 10)
    expect(price0Per1).toBeCloseTo(1, 10)
  })

  it('applies the display-decimal shift for an 18/6 pair', () => {
    // normalized (sqrtP/Q128)^2 ≈ 2e-12; shift = 10^(18−6) → ≈2.0 USDC per ETH.
    const { price1Per0 } = poolPrice({ slot: LIVE_SLOT, decimals0: 18, decimals1: 6 })
    expect(price1Per0).toBeGreaterThan(1.9)
    expect(price1Per0).toBeLessThan(2.1)
  })

  it('returns zeros for an unpriced pool', () => {
    expect(poolPrice({ slot: { sqrt_price: 0n }, decimals0: 6, decimals1: 6 })).toEqual({
      price1Per0: 0,
      price0Per1: 0,
    })
  })
})

describe('priceImpact', () => {
  it('small trades approach spot (tiny impact), large trades diverge', () => {
    const small = priceImpact({ slot: LIVE_SLOT, amountIn: 10n ** 15n, zeroForOne: true })
    const large = priceImpact({ slot: LIVE_SLOT, amountIn: 10n ** 20n, zeroForOne: true })
    expect(small.expectedOut > 0n).toBe(true)
    expect(small.impactBps).toBeLessThan(large.impactBps)
    // Larger input must not yield proportionally larger output (price moves away).
    const smallRate = Number(small.expectedOut) / 1e15
    const largeRate = Number(large.expectedOut) / 1e20
    expect(largeRate).toBeLessThan(smallRate)
  })

  it('is direction-consistent: out-and-back never profits', () => {
    const fwd = priceImpact({ slot: LIVE_SLOT, amountIn: 10n ** 18n, zeroForOne: true })
    const back = priceImpact({ slot: LIVE_SLOT, amountIn: fwd.expectedOut, zeroForOne: false })
    expect(back.expectedOut <= 10n ** 18n).toBe(true)
  })

  it('degrades safely on empty pools', () => {
    expect(priceImpact({ slot: { sqrt_price: 0n, liquidity: 0n }, amountIn: 1n, zeroForOne: true }))
      .toEqual({ expectedOut: 0n, impactBps: 0 })
  })
})

describe('portfolioValue', () => {
  it('sums decimal-adjusted holdings in quote units', () => {
    const total = portfolioValue([
      { amount: 2n * 10n ** 18n, decimals: 18, priceInQuote: 1900 }, // 2 ETH → 3800
      { amount: 500_000_000n, decimals: 6, priceInQuote: 1 },        // 500 USDC
    ])
    expect(total).toBeCloseTo(4300, 6)
  })
})

describe('feeAprEstimate', () => {
  it('volume × fee × 365 / value', () => {
    // 50k daily volume at 0.30% on a 10k position → 150/day → 5475%/yr… as a fraction.
    expect(feeAprEstimate({ volume24h: 50_000, feePips: 3000, positionValue: 10_000 })).toBeCloseTo(5.475, 3)
    expect(feeAprEstimate({ volume24h: 50_000, feePips: 3000, positionValue: 10_000, liquidityShare: 0.1 })).toBeCloseTo(0.5475, 4)
    expect(feeAprEstimate({ volume24h: 1, feePips: 100, positionValue: 0 })).toBe(0)
  })
})
