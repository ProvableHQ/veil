// Q64 fixed-point tick math, ported from the Provable AMM web app
// (amm-v3-api amm-app/src/lib/aleo.ts), which mirrors the on-chain
// tick_math table in shield_swap. The magic constants ARE the contract's —
// do not "improve" them; a one-off value produces prices the finalize
// asserts against.

/** Q64 fixed-point one (2^63) — the contract's sqrt-price scale. */
export const Q64 = 9223372036854775808n

/** Lowest tick the contract accepts. */
export const MIN_TICK = -400000

/** Highest tick the contract accepts. */
export const MAX_TICK = 400000

/**
 * Lowest sqrt_price the swap finalize accepts (sqrt price at MIN_TICK).
 * Use as the `sqrt_price_limit` for a swap that sells token0 (price falls).
 */
export const MIN_SQRT_PRICE = 19029805711n

/**
 * Highest sqrt_price the swap finalize accepts (sqrt price at MAX_TICK).
 * Use as the `sqrt_price_limit` for a swap that sells token1 (price rises).
 */
export const MAX_SQRT_PRICE = 4470386772317930780047134862n

// sqrt(1.0001^-bit) in Q64 for each power-of-two tick component.
const MAGIC_CONSTANTS: Record<number, bigint> = {
  1: 9222910902837697536n,
  2: 9222449791875588096n,
  3: 9221988703967300608n,
  4: 9221527639111677952n,
  8: 9219683610192801792n,
  16: 9215996658532725760n,
  32: 9208627177859081216n,
  64: 9193905890596798464n,
  128: 9164533880601766912n,
  256: 9106071067403056128n,
  512: 8990261907820801024n,
  1024: 8763043369415622656n,
  2048: 8325689215117605888n,
  4096: 7515375139346884608n,
  8192: 6123667489441693696n,
  16384: 4065682634442729984n,
  32768: 1792161827361994496n,
  65536: 348228825923923264n,
  131072: 13147394978735516n,
  262144: 18740867660568n,
  524288: 38079361n,
}

/**
 * Computes the Q64 sqrt price at a tick, matching the contract's table.
 *
 * Pure and local. The result is what the pool's `slot.sqrt_price` reads when
 * the active tick is exactly `tick` — used for insert hints, range bounds,
 * and price estimates.
 *
 * @param tick Tick index. Must lie within [MIN_TICK, MAX_TICK].
 * @returns The sqrt price in Q64 fixed point (`bigint`).
 * @throws When `tick` is outside the contract's supported range.
 *
 * @example
 * getSqrtPriceAtTick(0) === Q64 // price 1.0
 */
export function getSqrtPriceAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) throw new Error(`Tick ${tick} out of range [${MIN_TICK}, ${MAX_TICK}]`)
  if (tick === 0) return Q64

  const absTick = Math.abs(tick)
  const lowBits = absTick & 0x3
  let ratio: bigint
  if (lowBits === 0) ratio = Q64
  else ratio = MAGIC_CONSTANTS[lowBits]!

  // Multiply in the sqrt ratio for every set power-of-two component.
  const bitChecks = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288]
  for (const bit of bitChecks) {
    if ((absTick & bit) !== 0) {
      ratio = (ratio * MAGIC_CONSTANTS[bit]!) >> 63n
    }
  }

  // The table encodes negative ticks; invert for positive ones.
  if (tick < 0) return ratio
  return (Q64 * Q64) / ratio
}

/**
 * Rounds a tick down to the nearest multiple of the pool's tick spacing.
 *
 * Pure and local. Position bounds passed to `mint_private` MUST be
 * spacing-aligned or the contract rejects them.
 *
 * @param tick Tick index to align.
 * @param spacing The pool's tick spacing (from `getSlot` or `getFeeToTickSpacing`).
 * @returns The largest spacing-aligned tick ≤ `tick`.
 *
 * @example
 * roundTickToSpacing(-62215, 200) === -62400
 */
export function roundTickToSpacing(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing
}

/**
 * Returns the divisor the contract normalizes a token's raw amounts by.
 *
 * shield_swap accounts in 9-decimal-normalized units: every raw input amount
 * is divided by `10^max(0, decimals - 9)` and the finalize asserts
 * `raw % scale == 0`. Amounts whose low digits are not zero are dust the
 * contract rejects — validate before submitting.
 *
 * @param decimals The token's decimal places.
 * @returns The normalization divisor (`1n` for tokens with ≤ 9 decimals).
 *
 * @example
 * dustScale(18) === 1_000_000_000n // 18-dec token: last 9 digits must be 0
 */
export function dustScale(decimals: number): bigint {
  return decimals > 9 ? 10n ** BigInt(decimals - 9) : 1n
}
