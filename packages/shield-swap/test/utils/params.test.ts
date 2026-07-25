import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { Q128, MIN_SQRT_RATIO_X128, MAX_SQRT_RATIO_X128 } from '../../src/utils/q128.js'
import {
  resolveSwapParams,
  resolveMultiHopParams,
  getDeadline,
  generateSwapNonce,
  generateFieldNonce,
  formatSwapHop,
  EMPTY_SWAP_HOP_LITERAL,
  type SwapPoolState,
  type SwapSlotState,
} from '../../src/utils/params.js'

// Minimal pool/slot fixtures — the resolvers consume only token ordering and
// the current sqrt price (Q128.128; raw native amounts, no scales).
const POOL: SwapPoolState = {
  token0: '122352848155208110005843045field',
  token1: '15594200448253854747971580789field',
}

// Spot price 1.0 — sqrt price of exactly 2^128.
const SLOT: SwapSlotState = { sqrt_price: Q128 }

describe('resolveSwapParams', () => {
  it('derives direction and output token from pool ordering', () => {
    const p = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 1_000_000n, slippageBps: 50 })
    expect(p.zeroForOne).toBe(true)
    expect(p.tokenOutId).toBe(POOL.token1)
    const q = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token1, amountIn: 1n, slippageBps: 50 })
    expect(q.zeroForOne).toBe(false)
    expect(q.tokenOutId).toBe(POOL.token0)
  })

  it('applies slippage to an explicit quote exactly', () => {
    const p = resolveSwapParams({
      pool: POOL, slot: SLOT, tokenInId: POOL.token0,
      amountIn: 1_000_000n, slippageBps: 100, expectedOut: 1000n,
    })
    expect(p.amountOutMin).toBe(990n) // 1000 × (1 − 1%)
  })

  it('spot-estimates when no quote is given: (amountIn × sp²) >> 256 per direction', () => {
    // sqrt price 2×2^128 → price 4 token1/token0.
    const slot: SwapSlotState = { sqrt_price: 2n * Q128 }
    const sell0 = resolveSwapParams({ pool: POOL, slot, tokenInId: POOL.token0, amountIn: 1_000n, slippageBps: 0 })
    expect(sell0.amountOutMin).toBe(4_000n)
    const sell1 = resolveSwapParams({ pool: POOL, slot, tokenInId: POOL.token1, amountIn: 1_000n, slippageBps: 0 })
    expect(sell1.amountOutMin).toBe(250n)
  })

  it('accepts the slot sqrt price as { hi, lo } halves too', () => {
    const p = resolveSwapParams({
      pool: POOL,
      slot: { sqrt_price: { hi: 1n, lo: 0n } }, // == Q128, price 1.0
      tokenInId: POOL.token0,
      amountIn: 5_000n,
      slippageBps: 0,
    })
    expect(p.amountOutMin).toBe(5_000n)
  })

  it('rejects tokens not in the pool and bad slippage', () => {
    expect(() =>
      resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: '999field', amountIn: 1n, slippageBps: 50 }),
    ).toThrow(/not in this pool/)
    expect(() =>
      resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 1_000_000n, slippageBps: 10001 }),
    ).toThrow(/slippageBps/)
  })

  it('defaults the price limit to the directional extreme and validates overrides', () => {
    const sell0 = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token0, amountIn: 1_000_000n, slippageBps: 50 })
    expect(sell0.sqrtPriceLimit).toBe(MIN_SQRT_RATIO_X128)
    const sell1 = resolveSwapParams({ pool: POOL, slot: SLOT, tokenInId: POOL.token1, amountIn: 1n, slippageBps: 50 })
    expect(sell1.sqrtPriceLimit).toBe(MAX_SQRT_RATIO_X128)
    expect(() =>
      resolveSwapParams({
        pool: POOL, slot: SLOT, tokenInId: POOL.token0,
        amountIn: 1_000_000n, slippageBps: 50, sqrtPriceLimit: MAX_SQRT_RATIO_X128 + 1n,
      }),
    ).toThrow(/accepted range/)
  })

  it('rejects a limit not strictly beyond the current price (finalize would revert)', () => {
    expect(() =>
      resolveSwapParams({
        pool: POOL, slot: SLOT, tokenInId: POOL.token0,
        amountIn: 1_000_000n, slippageBps: 50, sqrtPriceLimit: Q128, // == current
      }),
    ).toThrow(/strictly beyond the current sqrt price/)
  })
})

describe('SwapHop formatting (U256 price bounds)', () => {
  it('encodes the Q128.128 bound as the { hi, lo } struct literal', () => {
    expect(formatSwapHop({ poolKey: '10field', zeroForOne: true, sqrtPriceLimit: Q128 })).toBe(
      '{ pool: 10field, zero_for_one: true, sqrt_price_limit: { hi: 1u128, lo: 0u128 } }',
    )
    expect(formatSwapHop({ poolKey: '10field', zeroForOne: false, sqrtPriceLimit: 42n })).toBe(
      '{ pool: 10field, zero_for_one: false, sqrt_price_limit: { hi: 0u128, lo: 42u128 } }',
    )
  })

  it('zero-pads the unused hop slot with a U256 zero bound', () => {
    expect(EMPTY_SWAP_HOP_LITERAL).toBe(
      '{ pool: 0field, zero_for_one: false, sqrt_price_limit: { hi: 0u128, lo: 0u128 } }',
    )
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

describe('resolveMultiHopParams', () => {
  const A = '1field'
  const B = '2field'
  const C = '3field'
  const pool = (token0: string, token1: string): SwapPoolState => ({ token0, token1 })
  const slotAt = (sqrtPrice: bigint): SwapSlotState => ({ sqrt_price: sqrtPrice })

  it('walks the token path and fixes each hop direction', () => {
    const r = resolveMultiHopParams({
      pools: [pool(A, B), pool(B, C)],
      slots: [slotAt(Q128), slotAt(Q128)],
      poolKeys: ['10field', '20field'],
      tokenInId: A,
      amountIn: 100n,
      slippageBps: 0,
    })
    expect(r.hops.map((h) => h.zeroForOne)).toEqual([true, true])
    expect(r.tokenOutId).toBe(C)
    expect(r.hops[0]!.sqrtPriceLimit).toBe(MIN_SQRT_RATIO_X128)
  })

  it('resolves a reverse-direction hop with its directional extreme', () => {
    const r = resolveMultiHopParams({
      pools: [pool(A, B), pool(C, B)],
      slots: [slotAt(Q128), slotAt(Q128)],
      poolKeys: ['10field', '20field'],
      tokenInId: A,
      amountIn: 100n,
      slippageBps: 0,
    })
    expect(r.hops[1]!.zeroForOne).toBe(false)
    expect(r.hops[1]!.sqrtPriceLimit).toBe(MAX_SQRT_RATIO_X128)
    expect(r.tokenOutId).toBe(C)
  })

  it('throws when the path does not connect', () => {
    expect(() =>
      resolveMultiHopParams({
        pools: [pool(A, B), pool(C, '4field')],
        slots: [slotAt(Q128), slotAt(Q128)],
        poolKeys: ['10field', '20field'],
        tokenInId: A,
        amountIn: 100n,
        slippageBps: 0,
      }),
    ).toThrow(/does not connect/)
  })

  it('throws outside 2–3 hops', () => {
    expect(() =>
      resolveMultiHopParams({
        pools: [pool(A, B)],
        slots: [slotAt(Q128)],
        poolKeys: ['10field'],
        tokenInId: A,
        amountIn: 100n,
        slippageBps: 0,
      }),
    ).toThrow(/2 or 3 hops/)
  })

  it('applies slippage once to the chained spot estimate', () => {
    // Both hops at spot price 1.0 (sqrt = 2^128): expected out == amountIn.
    const r = resolveMultiHopParams({
      pools: [pool(A, B), pool(B, C)],
      slots: [slotAt(Q128), slotAt(Q128)],
      poolKeys: ['10field', '20field'],
      tokenInId: A,
      amountIn: 10000n,
      slippageBps: 50,
    })
    expect(r.amountOutMin).toBe(9950n)
  })

  it('chains the spot estimate through mixed-direction hops', () => {
    // Hop 0 sells token0 at price 4; hop 1 sells token1 at price 4 (out ÷ 4).
    const r = resolveMultiHopParams({
      pools: [pool(A, B), pool(C, B)],
      slots: [slotAt(2n * Q128), slotAt(2n * Q128)],
      poolKeys: ['10field', '20field'],
      tokenInId: A,
      amountIn: 1000n,
      slippageBps: 0,
    })
    expect(r.amountOutMin).toBe(1000n) // ×4 then ÷4
  })

  it('prefers an explicit expectedOut over the spot estimate', () => {
    const r = resolveMultiHopParams({
      pools: [pool(A, B), pool(B, C)],
      slots: [slotAt(Q128), slotAt(Q128)],
      poolKeys: ['10field', '20field'],
      tokenInId: A,
      amountIn: 10000n,
      slippageBps: 100,
      expectedOut: 5000n,
    })
    expect(r.amountOutMin).toBe(4950n)
  })

  it('validates explicit per-hop price limits', () => {
    const base = {
      pools: [pool(A, B), pool(B, C)],
      slots: [slotAt(Q128), slotAt(Q128)],
      poolKeys: ['10field', '20field'],
      tokenInId: A,
      amountIn: 100n,
      slippageBps: 0,
    }
    expect(() =>
      resolveMultiHopParams({ ...base, sqrtPriceLimits: [MIN_SQRT_RATIO_X128, 1n] }),
    ).toThrow(/accepted range/)
    expect(() => resolveMultiHopParams({ ...base, sqrtPriceLimits: [MIN_SQRT_RATIO_X128] })).toThrow(
      /one entry per hop/,
    )
  })

  it('rejects a price limit not strictly beyond the current price (finalize would revert)', () => {
    const base = {
      pools: [pool(A, B), pool(B, C)],
      slots: [slotAt(Q128), slotAt(Q128)],
      poolKeys: ['10field', '20field'],
      tokenInId: A,
      amountIn: 100n,
      slippageBps: 0,
    }
    // Hop 0 sells token0 (zeroForOne): the bound must be BELOW the current
    // price; equal-to-current passes the static range but reverts on chain.
    expect(() => resolveMultiHopParams({ ...base, sqrtPriceLimits: [Q128, MAX_SQRT_RATIO_X128] })).toThrow(
      /strictly beyond the current sqrt price/,
    )
  })
})
