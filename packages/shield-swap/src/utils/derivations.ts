import type { PoolState, Slot } from '../generated/shield_swap.js'
import { Q64 } from './tick-math.js'

// Pure strategy primitives — no network I/O, no loops, no state. The un-fancy
// math every strategy re-derives, exported once so nobody re-implements the
// fixed-point conversions subtly wrong.

/** Caps a token's decimals at the AMM's 9-decimal internal precision. */
function normDecimals(decimals: number): number {
  return Math.min(decimals, 9)
}

/**
 * Parameters for {@link poolPrice}.
 *
 * @property slot Live pool state (`sqrt_price` is Q64 over normalized units).
 * @property decimals0 token0's decimal places (from token metadata).
 * @property decimals1 token1's decimal places.
 */
export type PoolPriceInput = {
  slot: Pick<Slot, 'sqrt_price'>
  decimals0: number
  decimals1: number
}

/**
 * Converts a pool's live sqrt price into human prices, both directions.
 *
 * The contract accounts in 9-decimal-normalized units: `sqrt_price` encodes
 * `sqrt(token1_norm / token0_norm)` in Q64. The human price re-applies the
 * decimal shift `10^(min(d0,9) − min(d1,9))`. Pure and local.
 *
 * @param input The slot and both tokens' decimals.
 * @returns `price1Per0` (token1 per 1.0 token0) and its inverse. `0` when
 *   the pool has no price yet.
 *
 * @example
 * const { price1Per0 } = poolPrice({ slot, decimals0: 18, decimals1: 6 })
 */
export function poolPrice(input: PoolPriceInput): { price1Per0: number; price0Per1: number } {
  const ratio = Number(input.slot.sqrt_price) / Number(Q64)
  const normalized = ratio * ratio
  if (!Number.isFinite(normalized) || normalized <= 0) return { price1Per0: 0, price0Per1: 0 }
  const shift = 10 ** (normDecimals(input.decimals0) - normDecimals(input.decimals1))
  const price1Per0 = normalized * shift
  return { price1Per0, price0Per1: 1 / price1Per0 }
}

/**
 * Parameters for {@link priceImpact}.
 *
 * @property pool Static pool config (normalization scales).
 * @property slot Live state (`sqrt_price`, in-range `liquidity`).
 * @property amountIn Raw atomic input amount (u128).
 * @property zeroForOne Trade direction (selling token0 when true).
 */
export type PriceImpactInput = {
  pool: Pick<PoolState, 'scale0' | 'scale1'>
  slot: Pick<Slot, 'sqrt_price' | 'liquidity'>
  amountIn: bigint
  zeroForOne: boolean
}

/**
 * Estimates a swap's output and price impact within the current tick range.
 *
 * Applies the constant-liquidity AMM step (`Δ√P` from the in-range `L`)
 * assuming the trade stays inside the active range and ignoring fees — an
 * estimate for sizing orders, not a quote. The on-chain swap (which walks
 * ticks and charges fees) is authoritative; expect the real output to be
 * slightly lower. Pure and local.
 *
 * @param input Pool scales, live slot, amount, and direction.
 * @returns Expected raw output (u128), and the impact in basis points
 *   (spot-vs-effective price). Zeroes when the pool has no liquidity.
 *
 * @example
 * const { expectedOut, impactBps } = priceImpact({ pool, slot, amountIn, zeroForOne: true })
 */
export function priceImpact(input: PriceImpactInput): { expectedOut: bigint; impactBps: number } {
  const L = input.slot.liquidity
  const sqrtP = input.slot.sqrt_price
  if (L === 0n || sqrtP === 0n || input.amountIn === 0n) return { expectedOut: 0n, impactBps: 0 }

  const scaleIn = input.zeroForOne ? input.pool.scale0 : input.pool.scale1
  const scaleOut = input.zeroForOne ? input.pool.scale1 : input.pool.scale0
  const dIn = input.amountIn / scaleIn // normalized input

  let normOut: bigint
  let sqrtPNew: bigint
  if (input.zeroForOne) {
    // Selling token0: √P falls. √P' = L·√P / (L + Δx·√P/Q64)
    const denom = L + (dIn * sqrtP) / Q64
    sqrtPNew = (L * sqrtP) / denom
    // Δy = L·(√P − √P') / Q64
    normOut = (L * (sqrtP - sqrtPNew)) / Q64
  } else {
    // Selling token1: √P rises. √P' = √P + Δy·Q64/L
    sqrtPNew = sqrtP + (dIn * Q64) / L
    // Δx = L·(√P' − √P)·Q64 / (√P'·√P)
    normOut = (L * (sqrtPNew - sqrtP) * Q64) / (sqrtPNew * sqrtP)
  }

  const expectedOut = normOut * scaleOut

  // Impact: effective price vs spot, in basis points.
  const spot = Number(sqrtP) / Number(Q64)
  const spotPrice = input.zeroForOne ? spot * spot : 1 / (spot * spot)
  const effective = dIn === 0n ? spotPrice : Number(normOut) / Number(dIn)
  const impact = spotPrice === 0 ? 0 : Math.abs(1 - effective / spotPrice) * 10_000
  return { expectedOut, impactBps: Math.round(impact * 100) / 100 }
}

/**
 * A holding to be valued by {@link portfolioValue}.
 *
 * @property amount Raw atomic amount (u128).
 * @property decimals The token's decimal places.
 * @property priceInQuote Price of 1.0 of this token in the quote currency.
 */
export type Holding = {
  amount: bigint
  decimals: number
  priceInQuote: number
}

/**
 * Sums holdings into a single quote-currency value.
 *
 * Pure and local. Prices come from wherever the caller trusts —
 * `poolPrice`, the API, an oracle.
 *
 * @param holdings The positions to sum.
 * @returns Total value in the quote currency (floating point — display
 *   math, not settlement math).
 *
 * @example
 * portfolioValue([{ amount: 2n * 10n ** 18n, decimals: 18, priceInQuote: 1900 }]) // 3800
 */
export function portfolioValue(holdings: Holding[]): number {
  let total = 0
  for (const h of holdings) {
    total += (Number(h.amount) / 10 ** h.decimals) * h.priceInQuote
  }
  return total
}

/**
 * Parameters for {@link feeAprEstimate}.
 *
 * @property volume24h 24h traded volume, in quote-currency units (e.g. from
 *   the API's pool stats).
 * @property feePips Pool fee in pips (u16, e.g. `3000` = 0.30%).
 * @property positionValue The position's current value in the same quote
 *   units.
 * @property liquidityShare The position's share of in-range liquidity,
 *   0..1. Defaults to 1 (whole-pool estimate).
 */
export type FeeAprEstimateInput = {
  volume24h: number
  feePips: number
  positionValue: number
  liquidityShare?: number
}

/**
 * Roughly annualizes LP fee earnings from a day of volume.
 *
 * `volume × fee × share × 365 / positionValue` — assumes yesterday repeats
 * daily and the position stays in range, so treat it as a comparison metric
 * between pools, not a forecast. Pure and local.
 *
 * @param input Volume, fee tier, and position sizing.
 * @returns Estimated APR as a fraction (0.12 = 12%). `0` for an empty position.
 *
 * @example
 * feeAprEstimate({ volume24h: 50_000, feePips: 3000, positionValue: 10_000 }) // ≈ 5.475
 */
export function feeAprEstimate(input: FeeAprEstimateInput): number {
  if (input.positionValue <= 0) return 0
  const share = input.liquidityShare ?? 1
  const dailyFees = input.volume24h * (input.feePips / 1_000_000) * share
  return (dailyFees * 365) / input.positionValue
}
