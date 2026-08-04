import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  Q128,
  MIN_SQRT_RATIO_X128,
  MAX_SQRT_RATIO_X128,
  MIN_TICK,
  MAX_TICK,
  MAGIC_START,
  MAGIC_CASCADE,
  toU256Parts,
  fromU256Parts,
  formatU256Literal,
  mulDiv,
  amount0DeltaX128,
  amount1DeltaX128,
  getSqrtPriceAtTickX128,
  getTickEstimateX128,
  U256_MAX,
  u256WrappingSub,
  feeGrowthInside,
  feeOwed,
  amountsForLiquidity,
  liquidityForAmounts,
} from '../../src/utils/q128.js'

// Vectors generated once from amm-v3's scripts/q128 Python oracles — the
// bit-exact mirrors the contract team differentially tests against the Leo
// source. Regenerate via the recipe in the fixture's sibling README if the
// contract math ever changes.
const vectors = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/q128-oracle-vectors.json'), 'utf8'),
) as {
  sqrtPriceAtTickX128: Array<{ tick: number; sqrtPriceX128: string }>
  tickEstimateX128: Array<{ sqrtPriceX128: string; tickEstimate: number }>
  mulDiv: Array<{ a: string; b: string; d: string; roundUp: boolean; result: string }>
  amounts: Array<{ sqrtA: string; sqrtB: string; liquidity: string; roundUp: boolean; amount0: string; amount1: string }>
  constants: { MIN_SQRT_RATIO_X128: string; MAX_SQRT_RATIO_X128: string; MAGIC_START: string[]; MAGIC: Record<string, string> }
}

describe('q128 constants', () => {
  it('bounds and magic constants match the oracle', () => {
    expect(MIN_SQRT_RATIO_X128).toBe(BigInt(vectors.constants.MIN_SQRT_RATIO_X128))
    expect(MAX_SQRT_RATIO_X128).toBe(BigInt(vectors.constants.MAX_SQRT_RATIO_X128))
    expect(MAGIC_START.map(String)).toEqual(vectors.constants.MAGIC_START)
    for (const [bit, value] of Object.entries(vectors.constants.MAGIC)) {
      const entry = MAGIC_CASCADE.find(([b]) => b === Number(bit))
      expect(entry?.[1], `cascade bit ${bit}`).toBe(BigInt(value))
    }
  })

  it('every magic constant appears in the pinned deployed bytecode as hi/lo u64 halves', () => {
    // The deployed program stores each 128-bit constant split for its
    // shift-free mul cascade — recombining pins our table to the chain.
    const bytecode = readFileSync(join(__dirname, '../../codegen/abi/shield_swap.aleo'), 'utf8')
    // The start ratios are compared whole; the cascade constants feed the
    // shift-free mul routine and are stored split into u64 halves.
    for (const constant of MAGIC_START) {
      expect(bytecode.includes(String(constant)), `start ratio ${constant}`).toBe(true)
    }
    for (const [bit, constant] of MAGIC_CASCADE) {
      const hi = constant >> 64n
      const lo = constant & ((1n << 64n) - 1n)
      expect(bytecode.includes(String(lo)), `bit ${bit}: lo half of ${constant}`).toBe(true)
      if (hi > 0n) expect(bytecode.includes(String(hi)), `bit ${bit}: hi half of ${constant}`).toBe(true)
    }
  })
})

describe('U256 parts', () => {
  it('splits and joins losslessly', () => {
    const value = (123n << 128n) + 456n
    expect(toU256Parts(value)).toEqual({ hi: 123n, lo: 456n })
    expect(fromU256Parts({ hi: 123n, lo: 456n })).toBe(value)
  })

  it('formats the on-chain struct literal', () => {
    expect(formatU256Literal(Q128)).toBe('{ hi: 1u128, lo: 0u128 }')
  })

  it('rejects values outside u256', () => {
    expect(() => toU256Parts(1n << 256n)).toThrow(/u256/i)
    expect(() => toU256Parts(-1n)).toThrow(/u256/i)
  })
})

describe('mulDiv', () => {
  it('matches the oracle vectors', () => {
    for (const v of vectors.mulDiv) {
      expect(mulDiv(BigInt(v.a), BigInt(v.b), BigInt(v.d), v.roundUp), JSON.stringify(v)).toBe(BigInt(v.result))
    }
  })
})

describe('amount deltas', () => {
  it('match the oracle vectors', () => {
    for (const v of vectors.amounts) {
      const args = [BigInt(v.sqrtA), BigInt(v.sqrtB), BigInt(v.liquidity), v.roundUp] as const
      expect(amount0DeltaX128(...args), `amt0 ${JSON.stringify(v)}`).toBe(BigInt(v.amount0))
      expect(amount1DeltaX128(...args), `amt1 ${JSON.stringify(v)}`).toBe(BigInt(v.amount1))
    }
  })
})

describe('getSqrtPriceAtTickX128', () => {
  it('matches the oracle across the domain including both bounds', () => {
    for (const v of vectors.sqrtPriceAtTickX128) {
      expect(getSqrtPriceAtTickX128(v.tick), `tick ${v.tick}`).toBe(BigInt(v.sqrtPriceX128))
    }
  })

  it('tick 0 is exactly Q128', () => {
    expect(getSqrtPriceAtTickX128(0)).toBe(Q128)
  })

  it('rejects ticks outside the protocol domain', () => {
    expect(() => getSqrtPriceAtTickX128(MAX_TICK + 1)).toThrow(/tick/i)
    expect(() => getSqrtPriceAtTickX128(MIN_TICK - 1)).toThrow(/tick/i)
  })
})

describe('getTickEstimateX128', () => {
  it('matches the oracle estimates', () => {
    for (const v of vectors.tickEstimateX128) {
      expect(getTickEstimateX128(BigInt(v.sqrtPriceX128)), `sp ${v.sqrtPriceX128}`).toBe(v.tickEstimate)
    }
  })
})

describe('u256WrappingSub', () => {
  it('subtracts normally when a >= b', () => {
    expect(u256WrappingSub(10n, 3n)).toBe(7n)
  })

  it('wraps modulo 2^256 when b > a (the contract u256_sub)', () => {
    expect(u256WrappingSub(5n, 7n)).toBe(U256_MAX - 1n)
  })
})

// Vectors ported from amm-v3 tests/test_amm_helpers.leo (t_fee_growth_inside,
// t_fee_growth_inside_wrapped): lower tick -100 out0=10/out1=20, upper tick
// 100 out0=5/out1=8, globals g0=1000/g1=2000.
describe('feeGrowthInside', () => {
  const base = { tickLower: -100, tickUpper: 100 }
  const vec = (tickCurrent: number, token: 0 | 1) =>
    feeGrowthInside({
      ...base,
      tickCurrent,
      feeGrowthOutsideLowerX128: token === 0 ? 10n : 20n,
      feeGrowthOutsideUpperX128: token === 0 ? 5n : 8n,
      feeGrowthGlobalX128: token === 0 ? 1000n : 2000n,
    })

  it('current tick in range: global minus both outsides', () => {
    expect(vec(0, 0)).toBe(985n)
    expect(vec(0, 1)).toBe(1972n)
  })

  it('current tick below the range', () => {
    expect(vec(-200, 0)).toBe(5n)
    expect(vec(-200, 1)).toBe(12n)
  })

  it('current tick above the range wraps at 2^256 (modular accounting)', () => {
    expect(vec(150, 0)).toBe(U256_MAX - 4n) // −5 mod 2^256
    expect(vec(150, 1)).toBe(U256_MAX - 11n) // −12 mod 2^256
  })

  it('exactly at the lower bound takes the in-range arm', () => {
    expect(vec(-100, 0)).toBe(985n)
    expect(vec(-100, 1)).toBe(1972n)
  })

  it('outside counters exceeding the global wrap negative (t_fee_growth_inside_wrapped)', () => {
    const w0 = feeGrowthInside({
      ...base,
      tickCurrent: 0,
      feeGrowthOutsideLowerX128: 3000n,
      feeGrowthOutsideUpperX128: 2500n,
      feeGrowthGlobalX128: 2000n,
    })
    expect(w0).toBe(U256_MAX - 3499n) // −3500 mod 2^256
  })
})

describe('feeOwed', () => {
  it('floors delta·L / 2^128', () => {
    expect(feeOwed(Q128, 0n, 5n)).toBe(5n)
    expect(feeOwed(1n << 127n, 0n, 4n)).toBe(2n)
    expect(feeOwed(1n << 127n, 0n, 1n)).toBe(0n)
  })

  it('matches the Leo vector: delta 3·2^128 at liquidity 7 → 21', () => {
    expect(feeOwed(3n * Q128, 0n, 7n)).toBe(21n)
  })

  it('uses the wrapped 256-bit delta when now < last', () => {
    expect(feeOwed(0n, Q128, 1n)).toBe(Q128 - 1n)
  })

  it('is zero at zero liquidity', () => {
    expect(feeOwed(Q128, 0n, 0n)).toBe(0n)
  })
})

describe('amountsForLiquidity', () => {
  const L = 94217047056n
  const lower = getSqrtPriceAtTickX128(-64400)
  const upper = getSqrtPriceAtTickX128(-60200)

  it('price below the range: all token0, amount1 = 0', () => {
    const price = getSqrtPriceAtTickX128(-70000)
    const { amount0, amount1 } = amountsForLiquidity(price, lower, upper, L, false)
    expect(amount0).toBe(amount0DeltaX128(lower, upper, L, false))
    expect(amount1).toBe(0n)
  })

  it('price at the lower bound counts as below (contract: sr <= lower)', () => {
    const { amount0, amount1 } = amountsForLiquidity(lower, lower, upper, L, false)
    expect(amount0).toBe(amount0DeltaX128(lower, upper, L, false))
    expect(amount1).toBe(0n)
  })

  it('price inside the range: token0 above price, token1 below price', () => {
    const price = getSqrtPriceAtTickX128(-62000)
    const { amount0, amount1 } = amountsForLiquidity(price, lower, upper, L, false)
    expect(amount0).toBe(amount0DeltaX128(price, upper, L, false))
    expect(amount1).toBe(amount1DeltaX128(lower, price, L, false))
    expect(amount0 > 0n && amount1 > 0n).toBe(true)
  })

  it('price at/above the upper bound: all token1, amount0 = 0', () => {
    const { amount0, amount1 } = amountsForLiquidity(upper, lower, upper, L, false)
    expect(amount0).toBe(0n)
    expect(amount1).toBe(amount1DeltaX128(lower, upper, L, false))
  })

  it('orders the bounds itself (sa/sb may arrive swapped)', () => {
    const price = getSqrtPriceAtTickX128(-62000)
    expect(amountsForLiquidity(price, upper, lower, L, false)).toEqual(
      amountsForLiquidity(price, lower, upper, L, false),
    )
  })

  it('zero liquidity yields zero amounts', () => {
    expect(amountsForLiquidity(lower, lower, upper, 0n, false)).toEqual({ amount0: 0n, amount1: 0n })
  })
})

describe('liquidityForAmounts', () => {
  const lower = getSqrtPriceAtTickX128(-64400)
  const upper = getSqrtPriceAtTickX128(-60200)
  const inside = getSqrtPriceAtTickX128(-62000)

  it('never asks for more than the amounts it was given', () => {
    // The property that keeps a mint from reverting for want of a base unit:
    // liquidity floors, so the deposit-side amounts for it fit inside the
    // originals. Swept across the tick domain, range widths, and magnitudes
    // rather than asserted on one case, since the failures live on rounding edges.
    for (const t of [-300000, -62400, -1200, 0, 1200, 62400, 300000]) {
      for (const w of [60, 1200, 12000]) {
        const [lo, hi] = [getSqrtPriceAtTickX128(t - w), getSqrtPriceAtTickX128(t + w)]
        for (const p of [lo, getSqrtPriceAtTickX128(t), hi]) {
          for (const a0 of [1n, 10n ** 7n, 10n ** 20n]) {
            for (const a1 of [1n, 10n ** 7n, 10n ** 20n]) {
              const liquidity = liquidityForAmounts(p, lo, hi, a0, a1)
              if (liquidity === 0n) continue
              const back = amountsForLiquidity(p, lo, hi, liquidity, true)
              expect(back.amount0 <= a0 && back.amount1 <= a1).toBe(true)
            }
          }
        }
      }
    }
  })

  it('round-trips a liquidity figure without drifting below it', () => {
    for (const liquidity of [1n, 10n ** 7n, 10n ** 15n, 10n ** 25n]) {
      for (const p of [lower, inside, upper]) {
        const { amount0, amount1 } = amountsForLiquidity(p, lower, upper, liquidity, true)
        expect(liquidityForAmounts(p, lower, upper, amount0, amount1)).toBeGreaterThanOrEqual(liquidity)
      }
    }
  })

  it('price below the range: token0 binds and token1 is ignored', () => {
    const price = getSqrtPriceAtTickX128(-70000)
    const liquidity = liquidityForAmounts(price, lower, upper, 10n ** 9n, 0n)
    expect(liquidity).toBeGreaterThan(0n)
    // No token1 is consumed there, so its amount cannot change the answer.
    expect(liquidityForAmounts(price, lower, upper, 10n ** 9n, 10n ** 30n)).toBe(liquidity)
  })

  it('price above the range: token1 binds and token0 is ignored', () => {
    const price = getSqrtPriceAtTickX128(-50000)
    const liquidity = liquidityForAmounts(price, lower, upper, 0n, 10n ** 9n)
    expect(liquidity).toBeGreaterThan(0n)
    expect(liquidityForAmounts(price, lower, upper, 10n ** 30n, 10n ** 9n)).toBe(liquidity)
  })

  it('in range: the shorter side caps the position', () => {
    const plenty = 10n ** 30n
    const short = 10n ** 6n
    const capped0 = liquidityForAmounts(inside, lower, upper, short, plenty)
    const capped1 = liquidityForAmounts(inside, lower, upper, plenty, short)
    const both = liquidityForAmounts(inside, lower, upper, short, short)
    // Whichever side is short governs, and shorting both cannot exceed either.
    expect(both).toBe(capped0 < capped1 ? capped0 : capped1)
    expect(both).toBeLessThanOrEqual(capped0)
    expect(both).toBeLessThanOrEqual(capped1)
  })

  it('orders the bounds itself (sa/sb may arrive swapped)', () => {
    expect(liquidityForAmounts(inside, upper, lower, 10n ** 9n, 10n ** 9n)).toBe(
      liquidityForAmounts(inside, lower, upper, 10n ** 9n, 10n ** 9n),
    )
  })

  it('is zero for dust against a wide range', () => {
    const wide0 = getSqrtPriceAtTickX128(-400000)
    const wide1 = getSqrtPriceAtTickX128(400000)
    expect(liquidityForAmounts(wide0, wide0, wide1, 1n, 1n)).toBe(0n)
    expect(liquidityForAmounts(inside, lower, upper, 0n, 0n)).toBe(0n)
  })
})
