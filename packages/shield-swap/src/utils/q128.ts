// Q128.128 fixed-point math for the shield_swap.aleo stack.
//
// Ports the contract's tick/price math bit-exactly. Constants are copied
// from the deployed program (they appear in the pinned bytecode as u64
// halves) and every function is differentially tested against the amm-v3
// scripts/q128 Python oracles (test/fixtures/q128-oracle-vectors.json).

/** One in Q128.128 fixed point (2^128) — the sqrt price at tick 0. */
export const Q128 = 1n << 128n

/** Largest representable u256 value. */
export const U256_MAX = (1n << 256n) - 1n

/** Lowest tick the protocol accepts. */
export const MIN_TICK = -400_000
/** Highest tick the protocol accepts. */
export const MAX_TICK = 400_000

/** sqrt price at MIN_TICK — the contract's lower price bound. */
export const MIN_SQRT_RATIO_X128 = 702075911466779181339691826087n
/** sqrt price at MAX_TICK — the contract's upper price bound. */
export const MAX_SQRT_RATIO_X128 = 164928161394119051704885410204944470744913033840n

/**
 * Start ratios for `abs(tick) & 3` = 1, 2, 3 — `round(2^128 / sqrt(1.0001^n))`
 * for n = 1, 2, 3. `abs(tick) & 3 == 0` starts at Q128.
 */
export const MAGIC_START: readonly [bigint, bigint, bigint] = [
  340265354078544963557816517032075149313n,
  340248342086729790484326174814286782778n,
  340231330945450418515964920540021147199n,
]

/**
 * The cascade table: `[bit, round(2^128 / sqrt(1.0001^bit))]` for bits 2..18
 * of `abs(tick)`. Bit 19 (0x80000) is omitted — unreachable within the
 * protocol tick domain (400000 < 2^19).
 */
export const MAGIC_CASCADE: ReadonlyArray<readonly [number, bigint]> = [
  [4, 340214320654664324051920982716015181260n],
  [8, 340146287995602323631171512101879684304n],
  [16, 340010263488231146823593991679159461444n],
  [32, 339738377640345403697157401104375502016n],
  [64, 339195258003219555707034227454543997025n],
  [128, 338111622100601834656805679988414885971n],
  [256, 335954724994790223023589805789778977700n],
  [512, 331682121138379247127172139078559817300n],
  [1024, 323299236684853023288211250268160618739n],
  [2048, 307163716377032989948697243942600083929n],
  [4096, 277268403626896220162999269216087595045n],
  [8192, 225923453940442621947126027127485391333n],
  [16384, 149997214084966997727330242082538205943n],
  [32768, 66119101136024775622716233608466517926n],
  [65536, 12847376061809297530290974190478138313n],
  [131072, 485053260817066172746253684029974020n],
  [262144, 691415978906521570653435304214168n],
]

// log2(sqrt(1.0001)) in the contract's 64.64-ish fixed representation —
// the divisor turning a log2 measurement into a tick estimate.
const LOG_SQRT_10001 = 1330584781654114n

const U128_MASK = (1n << 128n) - 1n

/**
 * Splits a u256 value into the on-chain struct's `{ hi, lo }` u128 halves.
 *
 * @throws When the value is negative or exceeds u256.
 */
export function toU256Parts(value: bigint): { hi: bigint; lo: bigint } {
  if (value < 0n || value > U256_MAX) throw new Error(`Value does not fit u256: ${value}`)
  return { hi: value >> 128n, lo: value & U128_MASK }
}

/** Joins `{ hi, lo }` u128 halves back into the numeric u256 value. */
export function fromU256Parts(parts: { hi: bigint; lo: bigint }): bigint {
  return (parts.hi << 128n) + parts.lo
}

/**
 * Formats a u256 value as the Aleo struct literal the contracts take as
 * input (e.g. a swap's `sqrt_price_limit`).
 *
 * @example
 * formatU256Literal(Q128) // '{ hi: 1u128, lo: 0u128 }'
 */
export function formatU256Literal(value: bigint): string {
  const { hi, lo } = toU256Parts(value)
  return `{ hi: ${hi}u128, lo: ${lo}u128 }`
}

/**
 * floor (or ceil) of `a * b / d` at full width — the contract's
 * `mul_div_round`. Division by zero yields 0, matching the on-chain helper.
 */
export function mulDiv(a: bigint, b: bigint, d: bigint, roundUp: boolean): bigint {
  if (d === 0n) return 0n
  const product = a * b
  const quotient = product / d
  if (roundUp && product % d !== 0n) return quotient + 1n
  return quotient
}

/**
 * Token0 owed for `liquidity` between two sqrt prices —
 * `L * 2^128 * (SB − SA) / (SA * SB)` as the contract's two chained
 * mul-divs (`amt0_x128_sat` without the saturation flag).
 */
export function amount0DeltaX128(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const [lower, upper] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA]
  const step = mulDiv(liquidity << 128n, upper - lower, upper, roundUp)
  return mulDiv(step, 1n, lower, roundUp)
}

/**
 * Token1 owed for `liquidity` between two sqrt prices —
 * `L * |SB − SA| / 2^128` with a round-up carry (`amt1_x128_sat`).
 */
export function amount1DeltaX128(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const diff = sqrtA < sqrtB ? sqrtB - sqrtA : sqrtA - sqrtB
  const product = liquidity * diff
  const quotient = product >> 128n
  if (roundUp && (product & U128_MASK) !== 0n) return quotient + 1n
  return quotient
}

/**
 * sqrt price (Q128.128) at a tick — bit-exact mirror of the contract's
 * `get_sqrt_price_at_tick_x128`: the magic-constant cascade over the bits of
 * `abs(tick)`, then `(2^256 − 1) / lo(ratio)` for positive ticks.
 *
 * @throws When the tick is outside the protocol domain (±400000).
 */
export function getSqrtPriceAtTickX128(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick out of range: ${tick} (allowed ${MIN_TICK}..${MAX_TICK})`)
  }
  const absTick = tick < 0 ? -tick : tick

  let ratio: bigint
  switch (absTick & 3) {
    case 0:
      ratio = Q128
      break
    case 1:
      ratio = MAGIC_START[0]
      break
    case 2:
      ratio = MAGIC_START[1]
      break
    default:
      ratio = MAGIC_START[2]
  }

  for (const [bit, magic] of MAGIC_CASCADE) {
    if ((absTick & bit) !== 0) {
      ratio = (ratio * magic) >> 128n
    }
  }

  if (tick > 0) {
    // The contract inverts via u256_max_div over the low 128 bits, guarding
    // lo == 0 with 1 (unreachable for ticks in the protocol domain).
    const lo = ratio & U128_MASK
    ratio = U256_MAX / (lo === 0n ? 1n : lo)
  }
  return ratio
}

// Most significant bit index of a positive bigint (0-based).
function msb(value: bigint): number {
  return value.toString(2).length - 1
}

// The contract's 14-round squaring loop measuring the fractional part of
// log2(x) for x normalized to [2^63, 2^64).
function log2Fractional(x: bigint): bigint {
  let result = 0n
  let y = x
  for (let bitpos = 63n; bitpos >= 50n; bitpos--) {
    y = (y * y) >> 63n
    const b = y >> 64n
    result |= b << bitpos
    if (bitpos > 50n) {
      y = y >> b
    }
  }
  return result
}

/**
 * Estimates the tick whose sqrt price is closest below `sqrtPriceX128` —
 * mirror of the contract's `get_tick_estimate_x128` (msb, normalized 14-round
 * log2 fraction, scaled by LOG_SQRT_10001 with truncating division).
 */
export function getTickEstimateX128(sqrtPriceX128: bigint): number {
  const bit = msb(sqrtPriceX128)
  const shift = BigInt(Math.abs(bit - 127))
  const normalized = bit >= 127 ? sqrtPriceX128 >> shift : sqrtPriceX128 << shift
  const lo = normalized & U128_MASK
  const logFrac = log2Fractional(lo >> 64n)
  const logShifted = (BigInt(bit - 128) << 64n) + logFrac
  // Aleo's i128 division truncates toward zero; BigInt division does too.
  const estimate = logShifted / LOG_SQRT_10001
  if (estimate < -(1n << 31n) || estimate > (1n << 31n) - 1n) {
    throw new Error(`Tick estimate does not fit i32: ${estimate}`)
  }
  return Number(estimate)
}
