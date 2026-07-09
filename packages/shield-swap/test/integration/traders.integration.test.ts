import { describe, it, expect, beforeAll } from 'vitest'
import { createPublicClient, http, type PublicClient } from '@veil/core'
import { ApiClient } from '../../src/api/client.js'
import { getPool } from '../../src/actions/reads/getPool.js'
import { getSlot } from '../../src/actions/reads/getSlot.js'
import { poolPrice, priceImpact, feeAprEstimate } from '../../src/utils/derivations.js'
import { getSqrtPriceAtTick, roundTickToSpacing } from '../../src/utils/tick-math.js'
import type { PoolState } from '../../src/generated/shield_swap.js'
import type { GetSlotReturnType } from '../../src/actions/reads/getSlot.js'

/**
 * Real-API integration for the analyses a trader actually runs — price
 * impact, LP range selection, and fee-APR estimation — exercising the pure
 * strategy helpers (poolPrice / priceImpact / feeAprEstimate / tick math)
 * against LIVE pool data. Read-only: no funds, no account, no transactions.
 * Gated on VEIL_INTEGRATION.
 *
 * The route-quote test was removed 2026-07-08: the amm-api stopped populating
 * `estimated_amount_out` on /route (routes themselves are valid). Restore
 * quote coverage when the indexer serves estimates again; slippage sizing
 * (resolveSwapParams) keeps unit coverage in test/utils/params.test.ts.
 *
 * Assertions check invariants and monotonic properties, not exact figures —
 * live liquidity and prices move, but the math relationships hold.
 */
const RUN = process.env.VEIL_INTEGRATION === '1'
const NODE = 'https://api.provable.com/v2'

describe.runIf(RUN)('trader workflows against live pool + route data', () => {
  let client: PublicClient
  let api: ApiClient
  // A live pool with non-zero liquidity, resolved once.
  let poolKey: string
  let pool: PoolState
  let slot: NonNullable<GetSlotReturnType>
  let decimals0: number
  let decimals1: number

  beforeAll(async () => {
    client = createPublicClient({ transport: http(NODE, { network: 'testnet' }) })
    api = new ApiClient()

    // Discover a pool that actually has liquidity to analyze.
    const pools = (await api.getPools({ limit: 25 })).data
    for (const p of pools) {
      const s = await getSlot(client, { poolKey: p.key })
      if (s && s.liquidity > 0n) {
        const cfg = await getPool(client, { poolKey: p.key })
        if (!cfg) continue
        poolKey = p.key
        pool = cfg
        slot = s
        decimals0 = p.token0_info?.decimals ?? 6
        decimals1 = p.token1_info?.decimals ?? 6
        break
      }
    }
    expect(poolKey, 'need at least one live pool with liquidity').toBeTruthy()
  }, 60_000)

  it('reads a coherent spot price from the live pool', () => {
    const { price1Per0, price0Per1 } = poolPrice({ slot, decimals0, decimals1 })
    expect(price1Per0).toBeGreaterThan(0)
    expect(price0Per1).toBeGreaterThan(0)
    expect(Number.isFinite(price1Per0)).toBe(true)
    // The two directions are reciprocals — a basic price sanity check.
    expect(price1Per0 * price0Per1).toBeCloseTo(1, 6)
  })

  it('estimates output and price impact from live liquidity (output grows with input)', () => {
    const unit = 10n ** BigInt(decimals0)
    const small = priceImpact({ pool, slot, amountIn: unit / 100n, zeroForOne: true }) // 0.01 token
    const big = priceImpact({ pool, slot, amountIn: unit, zeroForOne: true }) // 1 token

    expect(small.expectedOut).toBeGreaterThan(0n)
    expect(big.expectedOut).toBeGreaterThan(small.expectedOut) // more in → more out (CFMM)
    expect(small.impactBps).toBeGreaterThanOrEqual(0)
    expect(big.impactBps).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(big.impactBps)).toBe(true)
  })

  it('picks an in-range LP position bracketing the current price', () => {
    const spacing = slot.tick_spacing
    const lower = roundTickToSpacing(slot.tick - spacing * 5, spacing)
    const upper = roundTickToSpacing(slot.tick + spacing * 5, spacing)
    expect(lower % spacing === 0).toBe(true) // spacing-aligned (=== treats -0 as 0)
    expect(upper % spacing === 0).toBe(true)
    expect(lower).toBeLessThan(upper)

    // The chosen range must straddle the pool's live sqrt price — i.e. the
    // position is in range and earns fees now.
    expect(getSqrtPriceAtTick(lower)).toBeLessThanOrEqual(slot.sqrt_price)
    expect(getSqrtPriceAtTick(upper)).toBeGreaterThan(slot.sqrt_price)
  })

  it('estimates LP fee APR from live 24h volume (OHLCV)', async () => {
    const to = Math.floor(Date.now() / 1000)
    const candles = (await api.getPoolOhlcv(poolKey, { granularity: '1h', from: to - 86_400, to })).data
    const volume24h = candles.reduce((sum, c) => sum + (Number(c.volume) || 0), 0)

    const apr = feeAprEstimate({ volume24h, feePips: pool.fee, positionValue: 1000 })
    expect(Number.isFinite(apr)).toBe(true)
    expect(apr).toBeGreaterThanOrEqual(0)
    // More volume can only help fees — a zero position share can't earn.
    expect(feeAprEstimate({ volume24h, feePips: pool.fee, positionValue: 1000, liquidityShare: 0 })).toBe(0)
  }, 30_000)

  it('scans the market: every listed pool reads live trading state', async () => {
    const pools = (await api.getPools({ limit: 10 })).data
    expect(pools.length).toBeGreaterThan(0)
    let withLiquidity = 0
    for (const p of pools) {
      const s = await getSlot(client, { poolKey: p.key })
      if (s) {
        expect(typeof s.liquidity).toBe('bigint')
        expect(s.sqrt_price > 0n).toBe(true)
        if (s.liquidity > 0n) withLiquidity++
      }
    }
    expect(withLiquidity).toBeGreaterThan(0) // at least one tradeable pool
  }, 60_000)
})
