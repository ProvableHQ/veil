import { describe, it, expect } from 'vitest'
import type { Client, PoolState, Slot } from '@veil/core'
import {
  Q64,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
  getSqrtPriceAtTick,
  roundTickToSpacing,
  dustScale,
} from '../../src/utils/tick-math.js'
import {
  resolveSwapParams,
  getDeadline,
  generateSwapNonce,
  generateFieldNonce,
} from '../../src/utils/params.js'

describe('tick math (contract table)', () => {
  it('anchors: tick 0 = Q64, extremes = the finalize bounds', () => {
    // The contract's swap finalize accepts exactly [MIN_SQRT_PRICE, MAX_SQRT_PRICE],
    // which are the table values at MIN_TICK/MAX_TICK — golden anchors.
    expect(getSqrtPriceAtTick(0)).toBe(Q64)
    expect(getSqrtPriceAtTick(MIN_TICK)).toBe(MIN_SQRT_PRICE)
    expect(getSqrtPriceAtTick(MAX_TICK)).toBe(MAX_SQRT_PRICE)
  })

  it('low-bits entries are the dedicated precise constants (verified in deployed bytecode)', () => {
    // MAGIC[3] is NOT (MAGIC[1]×MAGIC[2])>>63 — it is a precise precomputed
    // sqrt(1.0001^-3), and the deployed v0_0_2 bytecode carries this exact
    // literal. tick=-3 returns it directly; tick=+3 is its Q64² inverse.
    expect(getSqrtPriceAtTick(-3)).toBe(9221988703967300608n)
    expect(getSqrtPriceAtTick(3)).toBe((Q64 * Q64) / 9221988703967300608n)
    expect(getSqrtPriceAtTick(-1)).toBe(9222910902837697536n)
    expect(getSqrtPriceAtTick(-2)).toBe(9222449791875588096n)
  })

  it('is strictly increasing in tick', () => {
    let prev = getSqrtPriceAtTick(-1000)
    for (const t of [-100, -1, 0, 1, 100, 1000]) {
      const cur = getSqrtPriceAtTick(t)
      expect(cur > prev).toBe(true)
      prev = cur
    }
  })

  it('rejects out-of-range ticks', () => {
    expect(() => getSqrtPriceAtTick(MIN_TICK - 1)).toThrow(/out of range/)
    expect(() => getSqrtPriceAtTick(MAX_TICK + 1)).toThrow(/out of range/)
  })

  it('roundTickToSpacing floors toward negative infinity', () => {
    expect(roundTickToSpacing(-62215, 200)).toBe(-62400)
    expect(roundTickToSpacing(62215, 200)).toBe(62200)
    expect(roundTickToSpacing(0, 60)).toBe(0)
  })

  it('dustScale is 1 for ≤9 decimals, 10^(d-9) above', () => {
    expect(dustScale(6)).toBe(1n)
    expect(dustScale(9)).toBe(1n)
    expect(dustScale(18)).toBe(1_000_000_000n)
  })
})

// Real testnet pool fixture (ETHx 18-dec / USDC 6-dec).
const POOL = {
  token0: '122352848155208110005843045field',
  token1: '15594200448253854747971580789field',
  fee: 10000,
  enabled: true,
  scale0: 1_000_000_000n,
  scale1: 1n,
} as unknown as PoolState

const SLOT = { sqrt_price: 411435173233802309n } as unknown as Slot

describe('resolveSwapParams', () => {
  it('derives direction and output token from pool ordering', () => {
    const p = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 1_000_000_000n, slippageBps: 50 })
    expect(p.zeroForOne).toBe(true)
    expect(p.tokenOutId).toBe(POOL.token1)
    const q = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token1, amountIn: 1n, slippageBps: 50 })
    expect(q.zeroForOne).toBe(false)
    expect(q.tokenOutId).toBe(POOL.token0)
  })

  it('applies slippage to an explicit quote exactly', () => {
    const p = resolveSwapParams({
      pool: POOL, slot: SLOT, tokenInId: POOL.token0,
      amountIn: 1_000_000_000n, slippageBps: 100, expectedOut: 1000n,
    })
    expect(p.amountOutMin).toBe(990n) // 1000 × (1 − 1%)
  })

  it('spot-estimates when no quote is given, and the estimate is sane', () => {
    // 1.0 ETHx raw (10^18) — spot ≈ normIn × (sqrtP/Q64)² in USDC raw units.
    const p = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 10n ** 18n, slippageBps: 0 })
    expect(p.amountOutMin > 0n).toBe(true)
    // (sqrtP/Q64)² ≈ 0.00199 → ~1.99e6 raw out for 1e9 normalized in.
    expect(p.amountOutMin).toBeGreaterThan(1_900_000n)
    expect(p.amountOutMin).toBeLessThan(2_100_000n)
  })

  it('rejects dust amounts the contract would revert on', () => {
    expect(() =>
      resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 10n ** 18n + 1n, slippageBps: 50 }),
    ).toThrow(/not a multiple/)
  })

  it('rejects tokens not in the pool and bad slippage', () => {
    expect(() =>
      resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: '999field', amountIn: 1n, slippageBps: 50 }),
    ).toThrow(/not in this pool/)
    expect(() =>
      resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 1_000_000_000n, slippageBps: 10001 }),
    ).toThrow(/slippageBps/)
  })

  it('defaults the price limit to the directional extreme and validates overrides', () => {
    const sell0 = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 1_000_000_000n, slippageBps: 50 })
    expect(sell0.sqrtPriceLimit).toBe(MIN_SQRT_PRICE)
    const sell1 = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token1, amountIn: 1n, slippageBps: 50 })
    expect(sell1.sqrtPriceLimit).toBe(MAX_SQRT_PRICE)
    expect(() =>
      resolveSwapParams({
        pool: POOL, slot: SLOT, tokenInId: POOL.token0,
        amountIn: 1_000_000_000n, slippageBps: 50, sqrtPriceLimit: MAX_SQRT_PRICE + 1n,
      }),
    ).toThrow(/accepted range/)
  })
})

describe('deadline + nonces', () => {
  it('getDeadline = current height + offset (default 100)', async () => {
    const client = { request: async () => 4242n } as unknown as Client
    expect(await getDeadline(client)).toBe(4342)
    expect(await getDeadline(client, { offsetBlocks: 10 })).toBe(4252)
  })

  it('generateSwapNonce yields distinct u64 bigints', () => {
    const a = generateSwapNonce()
    const b = generateSwapNonce()
    expect(typeof a).toBe('bigint')
    expect(a >= 0n && a < 2n ** 64n).toBe(true)
    expect(a).not.toBe(b) // 2^-64 collision odds — deterministic failure means broken RNG
  })

  it('generateFieldNonce yields distinct field literals', () => {
    const a = generateFieldNonce()
    expect(a.endsWith('field')).toBe(true)
    expect(BigInt(a.slice(0, -5)) < 2n ** 248n).toBe(true)
    expect(a).not.toBe(generateFieldNonce())
  })
})
