import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { previewMint } from '../../../src/actions/liquidity/previewMint.js'
import {
  amountsForLiquidity,
  formatU256Literal,
  getSqrtPriceAtTickX128,
  liquidityForAmounts,
} from '../../../src/utils/q128.js'

const POOL_KEY = '111field'
const TOKEN0 = '11field'
const TOKEN1 = '22field'
/** A whole ETH-scale side and a USDC-scale side, so both branches see real money. */
const BUDGET0 = 10n ** 18n
const BUDGET1 = 2_000_000n

/**
 * Chain fake serving one pool, its slot, and the fee tier's spacing.
 *
 * The slot's `sqrt_price` is derived from its own tick rather than pinned, so
 * the price and the tick cannot disagree — a mismatch there would silently
 * shift which side of the range the preview thinks the pool is trading at.
 */
function chain(
  options: {
    tick?: number
    spacing?: number
    fee?: number
    /** Spacing the fee registry binds; `null` serves no binding at all. */
    feeSpacing?: number | null
    /** Serves no pool, as an unknown pool key would. */
    noPool?: boolean
    /** Serves the pool but no slot, as a created-but-uninitialized pool would. */
    noSlot?: boolean
  } = {},
): Client {
  const tick = options.tick ?? 0
  const spacing = options.spacing ?? 60
  const fee = options.fee ?? 3000
  const feeSpacing = options.feeSpacing === undefined ? spacing : options.feeSpacing
  const slot =
    `{\n  tick: ${tick}i32,\n  tick_spacing: ${spacing}u32,\n` +
    `  sqrt_price: ${formatU256Literal(getSqrtPriceAtTickX128(tick))},\n  fee_protocol: 0u8,\n` +
    `  liquidity: 1000u128,\n  fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 },\n` +
    `  fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 },\n  max_liquidity_per_tick: 1000000u128,\n` +
    `  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: ${tick - spacing}i32,\n` +
    `  next_init_above: ${tick + spacing}i32\n}`
  return {
    request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
      const { mapping } = req.params ?? {}
      if (mapping === 'pools') {
        if (options.noPool) return null
        return `{\n  token0: ${TOKEN0},\n  token1: ${TOKEN1},\n  fee: ${fee}u16,\n  enabled: true\n}`
      }
      if (mapping === 'slots') return options.noSlot ? null : slot
      if (mapping === 'fee_to_tick_spacing') return feeSpacing === null ? null : `${feeSpacing}u32`
      return null
    },
  } as unknown as Client
}

describe('previewMint', () => {
  it('centers a percentage range on the active tick and aligns both bounds', async () => {
    const preview = await previewMint(chain(), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
      rangePercent: 5,
    })

    // ±5% of price is ln(1.05)/ln(1.0001) ≈ +488 and ln(0.95)/ln(1.0001) ≈ -513
    // ticks, floored onto the pool's 60-step grid.
    expect(preview.tickLower).toBe(-540)
    expect(preview.tickUpper).toBe(480)
    expect(preview.tickCurrent).toBe(0)
    expect(preview.inRange).toBe(true)
    expect(preview.poolKey).toBe(POOL_KEY)
    expect(preview.token0Id).toBe(TOKEN0)
    expect(preview.token1Id).toBe(TOKEN1)
    expect(preview.fee).toBe(3000)
    expect(preview.tickSpacing).toBe(60)
  })

  it('defaults to a ±5% range when neither bounds nor a width are given', async () => {
    const preview = await previewMint(chain(), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
    })
    expect([preview.tickLower, preview.tickUpper]).toEqual([-540, 480])
  })

  it('reports amounts that fit the budget and back the liquidity it claims', async () => {
    const preview = await previewMint(chain(), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
      rangePercent: 5,
    })

    const sqrtPrice = getSqrtPriceAtTickX128(0)
    const sqrtLower = getSqrtPriceAtTickX128(preview.tickLower)
    const sqrtUpper = getSqrtPriceAtTickX128(preview.tickUpper)
    expect(preview.liquidity).toBe(liquidityForAmounts({ sqrtPriceX128: sqrtPrice, sqrtLowerX128: sqrtLower, sqrtUpperX128: sqrtUpper, amount0: BUDGET0, amount1: BUDGET1 }))
    expect(preview.liquidity).toBeGreaterThan(0n)

    // Deposit-side rounding (`true`), so neither side lands a base unit short of
    // what the range requires and reverts the mint.
    const rounded = amountsForLiquidity({ sqrtPriceX128: sqrtPrice, sqrtLowerX128: sqrtLower, sqrtUpperX128: sqrtUpper, liquidity: preview.liquidity, roundUp: true })
    expect(preview.amount0).toBe(rounded.amount0)
    expect(preview.amount1).toBe(rounded.amount1)
    // The whole point of previewing: what is consumed never exceeds what the
    // caller has, so a mint built from these amounts cannot overdraw.
    expect(preview.amount0).toBeLessThanOrEqual(BUDGET0)
    expect(preview.amount1).toBeLessThanOrEqual(BUDGET1)
    // And the amounts still back the liquidity reported, rather than a smaller one.
    expect(
      liquidityForAmounts({ sqrtPriceX128: sqrtPrice, sqrtLowerX128: sqrtLower, sqrtUpperX128: sqrtUpper, amount0: preview.amount0, amount1: preview.amount1 }),
    ).toBeGreaterThanOrEqual(preview.liquidity)
    // The budgets come back untouched, so a caller can show what went unused.
    expect(preview.amount0Desired).toBe(BUDGET0)
    expect(preview.amount1Desired).toBe(BUDGET1)
  })

  it('floors explicit bounds onto the spacing grid instead of trusting them', async () => {
    const preview = await previewMint(chain(), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
      tickLower: -95,
      tickUpper: 95,
    })
    // What `mint` would do to the same bounds — the contract rejects unaligned
    // ticks, so a preview that echoed -95/95 would describe a reverting mint.
    expect(preview.tickLower).toBe(-120)
    expect(preview.tickUpper).toBe(60)
    expect(preview.inRange).toBe(true)
  })

  it('funds a range wholly below the price from token1 alone', async () => {
    const preview = await previewMint(chain(), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
      tickLower: -600,
      tickUpper: -300,
    })
    expect(preview.inRange).toBe(false)
    expect(preview.amount0).toBe(0n)
    expect(preview.amount1).toBeGreaterThan(0n)
    expect(preview.amount1).toBeLessThanOrEqual(BUDGET1)
  })

  it('funds a range wholly above the price from token0 alone', async () => {
    const preview = await previewMint(chain(), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
      tickLower: 300,
      tickUpper: 600,
    })
    expect(preview.inRange).toBe(false)
    expect(preview.amount0).toBeGreaterThan(0n)
    expect(preview.amount0).toBeLessThanOrEqual(BUDGET0)
    expect(preview.amount1).toBe(0n)
  })

  it('reports zero liquidity for a deposit that backs nothing, rather than failing', async () => {
    // An in-range position is funded from both sides, so a budget with one side
    // empty supports no liquidity however large the other side is.
    const preview = await previewMint(chain(), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: 0n,
      rangePercent: 5,
    })
    // A mint here would cost a fee and open nothing. Refusing is the caller's
    // decision to make, so the preview reports the zero rather than throwing.
    expect(preview.liquidity).toBe(0n)
    expect(preview.amount0).toBe(0n)
    expect(preview.amount1).toBe(0n)
  })

  it('reports the fee tier’s spacing beside the pool’s own, mismatch and all', async () => {
    const agreed = await previewMint(chain({ spacing: 60, feeSpacing: 60 }), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
    })
    expect(agreed.feeTierSpacing).toBe(60)

    // A pool whose spacing has drifted from its fee tier holds positions on a
    // grid the registry cannot describe. The pool's own spacing is what `mint`
    // aligns to, so that is what the bounds follow — the registry's value is
    // reported so a caller can see the disagreement.
    const drifted = await previewMint(chain({ spacing: 60, feeSpacing: 200 }), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
    })
    expect(drifted.tickSpacing).toBe(60)
    expect(drifted.feeTierSpacing).toBe(200)
    expect([drifted.tickLower, drifted.tickUpper]).toEqual([-540, 480])

    const unbound = await previewMint(chain({ feeSpacing: null }), {
      poolKey: POOL_KEY,
      amount0Desired: BUDGET0,
      amount1Desired: BUDGET1,
    })
    expect(unbound.feeTierSpacing).toBeNull()
  })

  it('refuses a percentage range finer than one spacing step, naming the spacing', async () => {
    // ±0.01% is ±1 tick, and both bounds floor into the same 60-wide bucket
    // around tick 30 — an empty range the contract would reject.
    await expect(
      previewMint(chain({ tick: 30, spacing: 60 }), {
        poolKey: POOL_KEY,
        amount0Desired: BUDGET0,
        amount1Desired: BUDGET1,
        rangePercent: 0.01,
      }),
    ).rejects.toThrow(/collapses to a single tick.*spacing of 60/s)
  })

  it('refuses explicit bounds that align to an empty range', async () => {
    await expect(
      previewMint(chain(), {
        poolKey: POOL_KEY,
        amount0Desired: BUDGET0,
        amount1Desired: BUDGET1,
        tickLower: 10,
        tickUpper: 50,
      }),
    ).rejects.toThrow(/empty range/)
  })

  it('refuses a percentage outside the open range 0 to 100', async () => {
    for (const rangePercent of [0, -5, 100, 150]) {
      await expect(
        previewMint(chain(), {
          poolKey: POOL_KEY,
          amount0Desired: BUDGET0,
          amount1Desired: BUDGET1,
          rangePercent,
        }),
      ).rejects.toThrow(/rangePercent must be greater than 0 and less than 100/)
    }
  })

  it('refuses one bound without the other', async () => {
    await expect(
      previewMint(chain(), { poolKey: POOL_KEY, amount0Desired: BUDGET0, amount1Desired: BUDGET1, tickLower: -600 }),
    ).rejects.toThrow(/tickLower and tickUpper together/)
    await expect(
      previewMint(chain(), { poolKey: POOL_KEY, amount0Desired: BUDGET0, amount1Desired: BUDGET1, tickUpper: 600 }),
    ).rejects.toThrow(/tickLower and tickUpper together/)
  })

  it('names the missing pool rather than previewing against nothing', async () => {
    await expect(
      previewMint(chain({ noPool: true }), {
        poolKey: POOL_KEY,
        amount0Desired: BUDGET0,
        amount1Desired: BUDGET1,
      }),
    ).rejects.toThrow(/Pool 111field does not exist/)
    await expect(
      previewMint(chain({ noSlot: true }), {
        poolKey: POOL_KEY,
        amount0Desired: BUDGET0,
        amount1Desired: BUDGET1,
      }),
    ).rejects.toThrow(/has no slot state/)
  })
})
