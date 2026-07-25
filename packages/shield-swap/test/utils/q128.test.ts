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
