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

/**
 * Ticks anchoring each end of a pool's initialized-tick list.
 *
 * One step beyond the usable range, so they are never valid position bounds —
 * they exist so the list always has a predecessor and successor to link
 * against, which is what makes an insert hint resolvable for any target.
 */
export const MIN_TICK_SENTINEL = MIN_TICK - 1
export const MAX_TICK_SENTINEL = MAX_TICK + 1

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
 * Parameters for {@link amount0DeltaX128} and {@link amount1DeltaX128}.
 *
 * @property sqrtLowerX128 One end of the span as a sqrt price, Q128.128. Ends may
 *   arrive in either order — they are sorted internally.
 * @property sqrtUpperX128 The other end, Q128.128.
 * @property liquidity The position's liquidity (u128).
 * @property roundUp Round the result up. `true` for a deposit, where the caller
 *   must cover the amount; `false` for a withdrawal, where rounding up would pay
 *   out a base unit the position does not hold.
 */
export type AmountDeltaParameters = {
  sqrtLowerX128: bigint
  sqrtUpperX128: bigint
  liquidity: bigint
  roundUp: boolean
}

/**
 * Token0 owed for `liquidity` between two sqrt prices —
 * `L * 2^128 * (SB − SA) / (SA * SB)` as the contract's two chained
 * mul-divs (`amt0_x128_sat` without the saturation flag).
 *
 * @param params The span, the liquidity, and the rounding direction.
 * @returns Raw base units of token0.
 *
 * @example
 * amount0DeltaX128({ sqrtLowerX128: lower, sqrtUpperX128: upper, liquidity, roundUp: true })
 */
export function amount0DeltaX128(params: AmountDeltaParameters): bigint
/**
 * @deprecated Four positional arguments, three of them same-typed, transpose
 *   without a type error and return a plausible wrong number. Pass
 *   {@link AmountDeltaParameters} instead. Removed in the next major.
 */
export function amount0DeltaX128(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint
export function amount0DeltaX128(
  a: AmountDeltaParameters | bigint,
  b?: bigint,
  c?: bigint,
  d?: boolean,
): bigint {
  const { sqrtLowerX128, sqrtUpperX128, liquidity, roundUp } = normalizeDelta(a, b, c, d)
  const [lower, upper] =
    sqrtLowerX128 < sqrtUpperX128 ? [sqrtLowerX128, sqrtUpperX128] : [sqrtUpperX128, sqrtLowerX128]
  const step = mulDiv(liquidity << 128n, upper - lower, upper, roundUp)
  return mulDiv(step, 1n, lower, roundUp)
}

/**
 * Token1 owed for `liquidity` between two sqrt prices —
 * `L * |SB − SA| / 2^128` with a round-up carry (`amt1_x128_sat`).
 *
 * @param params The span, the liquidity, and the rounding direction.
 * @returns Raw base units of token1.
 *
 * @example
 * amount1DeltaX128({ sqrtLowerX128: lower, sqrtUpperX128: upper, liquidity, roundUp: false })
 */
export function amount1DeltaX128(params: AmountDeltaParameters): bigint
/**
 * @deprecated Four positional arguments, three of them same-typed, transpose
 *   without a type error and return a plausible wrong number. Pass
 *   {@link AmountDeltaParameters} instead. Removed in the next major.
 */
export function amount1DeltaX128(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint
export function amount1DeltaX128(
  a: AmountDeltaParameters | bigint,
  b?: bigint,
  c?: bigint,
  d?: boolean,
): bigint {
  const { sqrtLowerX128, sqrtUpperX128, liquidity, roundUp } = normalizeDelta(a, b, c, d)
  const diff = sqrtLowerX128 < sqrtUpperX128 ? sqrtUpperX128 - sqrtLowerX128 : sqrtLowerX128 - sqrtUpperX128
  const product = liquidity * diff
  const quotient = product >> 128n
  if (roundUp && (product & U128_MASK) !== 0n) return quotient + 1n
  return quotient
}

/** Accepts either call shape for the delta helpers and returns the object one. */
function normalizeDelta(
  a: AmountDeltaParameters | bigint,
  b?: bigint,
  c?: bigint,
  d?: boolean,
): AmountDeltaParameters {
  return typeof a === 'bigint'
    ? { sqrtLowerX128: a, sqrtUpperX128: b!, liquidity: c!, roundUp: d! }
    : a
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

/**
 * Subtracts two u256 values with 256-bit modular wrap-around — the
 * contract's `u256::u256_sub`. Fee-growth accumulators rely on modular
 * arithmetic, so a "negative" delta is meaningful, not an error. Pure and
 * local.
 */
export function u256WrappingSub(a: bigint, b: bigint): bigint {
  return (a - b) & U256_MAX
}

/**
 * Computes fee growth inside a tick range for one fee accumulator —
 * bit-exact mirror of the contract's `get_fee_growth_inside` (amm-v3
 * `main.leo`), applied one token at a time. All `*X128` inputs and the
 * return value are Q128.128 accumulators (u256, modular). Pure and local.
 *
 * @param params.tickCurrent The pool's current tick (`slot.tick`).
 * @param params.tickLower Lower bound of the position's range.
 * @param params.tickUpper Upper bound of the position's range.
 * @param params.feeGrowthOutsideLowerX128 The lower tick's
 *   `fee_growth_outside*_x_128`. Pass 0n for an uninitialized tick — only
 *   reachable at zero position liquidity, where the result multiplies out.
 * @param params.feeGrowthOutsideUpperX128 The upper tick's counterpart.
 * @param params.feeGrowthGlobalX128 The pool-wide accumulator
 *   (`slot.fee_growth_global*_x_128`).
 * @returns The Q128.128 fee growth inside the range, modular at 2^256.
 *
 * @example
 * const inside0 = feeGrowthInside({
 *   tickCurrent: slot.tick,
 *   tickLower: -100,
 *   tickUpper: 100,
 *   feeGrowthOutsideLowerX128: lower.fee_growth_outside0_x_128,
 *   feeGrowthOutsideUpperX128: upper.fee_growth_outside0_x_128,
 *   feeGrowthGlobalX128: slot.fee_growth_global0_x_128,
 * })
 */
export function feeGrowthInside(params: {
  tickCurrent: number
  tickLower: number
  tickUpper: number
  feeGrowthOutsideLowerX128: bigint
  feeGrowthOutsideUpperX128: bigint
  feeGrowthGlobalX128: bigint
}): bigint {
  const below =
    params.tickCurrent >= params.tickLower
      ? params.feeGrowthOutsideLowerX128
      : u256WrappingSub(params.feeGrowthGlobalX128, params.feeGrowthOutsideLowerX128)
  const above =
    params.tickCurrent < params.tickUpper
      ? params.feeGrowthOutsideUpperX128
      : u256WrappingSub(params.feeGrowthGlobalX128, params.feeGrowthOutsideUpperX128)
  return u256WrappingSub(u256WrappingSub(params.feeGrowthGlobalX128, below), above)
}

/**
 * Parameters for {@link feeOwed}.
 *
 * @property feeGrowthInsideNowX128 Current fee growth inside the range, Q128.128.
 * @property feeGrowthInsideLastX128 The position's checkpoint
 *   (`fee_growth_inside*_last_x_128`), Q128.128.
 * @property liquidity The position's live liquidity (u128).
 */
export type FeeOwedParameters = {
  feeGrowthInsideNowX128: bigint
  feeGrowthInsideLastX128: bigint
  liquidity: bigint
}

/**
 * Settles a fee-growth delta into owed tokens — the contract's `fee_owed`:
 * floor((now − last) · liquidity / 2^128) over the 256-bit modular delta.
 * The contract additionally asserts the result fits u128; this mirror
 * returns the floored value unchecked (a read never rejects chain state).
 * Amounts are raw base units (u128 on chain). Pure and local.
 *
 * @param params The two growth figures and the liquidity they apply to.
 * @returns Raw base units owed since the checkpoint.
 *
 * @example
 * const owed0 = feeOwed({
 *   feeGrowthInsideNowX128: inside0,
 *   feeGrowthInsideLastX128: position.fee_growth_inside0_last_x_128,
 *   liquidity: position.liquidity,
 * })
 */
export function feeOwed(params: FeeOwedParameters): bigint
/**
 * @deprecated Three same-typed bigints in a row: transposing the two growth
 *   figures wraps the subtraction and returns an enormous fee. Pass
 *   {@link FeeOwedParameters} instead. Removed in the next major.
 */
export function feeOwed(feeGrowthInsideNowX128: bigint, feeGrowthInsideLastX128: bigint, liquidity: bigint): bigint
export function feeOwed(a: FeeOwedParameters | bigint, b?: bigint, c?: bigint): bigint {
  const p =
    typeof a === 'bigint'
      ? { feeGrowthInsideNowX128: a, feeGrowthInsideLastX128: b!, liquidity: c! }
      : a
  const delta = u256WrappingSub(p.feeGrowthInsideNowX128, p.feeGrowthInsideLastX128)
  return (delta * p.liquidity) >> 128n
}

/**
 * Parameters for {@link amountsForLiquidity}.
 *
 * @property sqrtPriceX128 The pool's current sqrt price (`slot.sqrt_price`),
 *   Q128.128.
 * @property sqrtLowerX128 One range bound as a sqrt price, Q128.128. Bounds may
 *   arrive in either order — they are sorted internally.
 * @property sqrtUpperX128 The other range bound, Q128.128.
 * @property liquidity The position's liquidity (u128).
 * @property roundUp Rounds each amount up instead of down. Defaults to `false`
 *   (the withdrawal-side convention); pass `true` only to mirror deposit-side
 *   checks, where the caller must cover what it reports.
 */
export type AmountsForLiquidityParameters = {
  sqrtPriceX128: bigint
  sqrtLowerX128: bigint
  sqrtUpperX128: bigint
  liquidity: bigint
  roundUp?: boolean
}

/**
 * Splits a position's liquidity into current token amounts — bit-exact
 * mirror of the contract's `view_amounts_for_liquidity`: all token0 when the
 * price sits at or below the range, all token1 at or above it, a mix inside.
 * Bounds may arrive in either order. Amounts are raw base units. Pure and
 * local.
 *
 * @param params The price, the range, the liquidity, and the rounding direction.
 * @returns Raw base-unit amounts of each pool token backing the liquidity.
 *
 * @example
 * const { amount0, amount1 } = amountsForLiquidity({
 *   sqrtPriceX128: slot.sqrt_price,
 *   sqrtLowerX128: getSqrtPriceAtTickX128(tickLower),
 *   sqrtUpperX128: getSqrtPriceAtTickX128(tickUpper),
 *   liquidity: position.liquidity,
 * })
 */
export function amountsForLiquidity(params: AmountsForLiquidityParameters): {
  amount0: bigint
  amount1: bigint
}
/**
 * @deprecated Five positional arguments, four of them same-typed, transpose
 *   without a type error — swapping the price for a bound silently reports a
 *   one-sided position. Pass {@link AmountsForLiquidityParameters} instead.
 *   Removed in the next major.
 */
export function amountsForLiquidity(
  sqrtPriceX128: bigint,
  sqrtAX128: bigint,
  sqrtBX128: bigint,
  liquidity: bigint,
  roundUp?: boolean,
): { amount0: bigint; amount1: bigint }
export function amountsForLiquidity(
  a: AmountsForLiquidityParameters | bigint,
  b?: bigint,
  c?: bigint,
  d?: bigint,
  e = false,
): { amount0: bigint; amount1: bigint } {
  const p =
    typeof a === 'bigint'
      ? { sqrtPriceX128: a, sqrtLowerX128: b!, sqrtUpperX128: c!, liquidity: d!, roundUp: e }
      : a
  const roundUp = p.roundUp ?? false
  const lower = p.sqrtLowerX128 < p.sqrtUpperX128 ? p.sqrtLowerX128 : p.sqrtUpperX128
  const upper = p.sqrtLowerX128 < p.sqrtUpperX128 ? p.sqrtUpperX128 : p.sqrtLowerX128
  const liquidity = p.liquidity
  // Contract: below := !(lower < price), i.e. price <= lower.
  if (p.sqrtPriceX128 <= lower) {
    return {
      amount0: amount0DeltaX128({ sqrtLowerX128: lower, sqrtUpperX128: upper, liquidity, roundUp }),
      amount1: 0n,
    }
  }
  if (p.sqrtPriceX128 < upper) {
    return {
      amount0: amount0DeltaX128({
        sqrtLowerX128: p.sqrtPriceX128,
        sqrtUpperX128: upper,
        liquidity,
        roundUp,
      }),
      amount1: amount1DeltaX128({
        sqrtLowerX128: lower,
        sqrtUpperX128: p.sqrtPriceX128,
        liquidity,
        roundUp,
      }),
    }
  }
  return {
    amount0: 0n,
    amount1: amount1DeltaX128({ sqrtLowerX128: lower, sqrtUpperX128: upper, liquidity, roundUp }),
  }
}

/**
 * Liquidity that `amount0` of token0 supports across a sqrt-price span —
 * the inverse of {@link amount0DeltaX128}, `a0 * SA * SB / (2^128 * (SB − SA))`.
 * Floors, so the result never overstates what the amount covers.
 */
function liquidityForAmount0(lower: bigint, upper: bigint, amount0: bigint): bigint {
  // Scaled down by 2^128 first, matching the forward direction's chained
  // mul-divs rather than multiplying out to 2^256 and dividing back.
  const intermediate = mulDiv(lower, upper, Q128, false)
  return mulDiv(amount0, intermediate, upper - lower, false)
}

/**
 * Liquidity that `amount1` of token1 supports across a sqrt-price span —
 * the inverse of {@link amount1DeltaX128}, `a1 * 2^128 / (SB − SA)`. Floors.
 */
function liquidityForAmount1(lower: bigint, upper: bigint, amount1: bigint): bigint {
  return mulDiv(amount1, Q128, upper - lower, false)
}

/**
 * Parameters for {@link liquidityForAmount}.
 *
 * @property sqrtPriceX128 The pool's current sqrt price (`slot.sqrt_price`),
 *   Q128.128.
 * @property sqrtLowerX128 One range bound as a sqrt price, Q128.128. Bounds may
 *   arrive in either order — they are sorted internally.
 * @property sqrtUpperX128 The other range bound, Q128.128.
 * @property side Which token the amount is denominated in — `0` or `1`.
 * @property amount Raw base units of that token.
 */
export type LiquidityForAmountParameters = {
  sqrtPriceX128: bigint
  sqrtLowerX128: bigint
  sqrtUpperX128: bigint
  side: 0 | 1
  amount: bigint
}

/**
 * Derives the liquidity ONE side alone supports over a range.
 *
 * Applies when a depositor fixes one token and wants the other's requirement
 * derived rather than capped by a budget: pair the result with
 * {@link amountsForLiquidity} to learn the minimum of the other side.
 * {@link liquidityForAmounts} answers a different question — what a pair of
 * ceilings supports — and there the shorter side silently governs.
 *
 * Which span the amount is priced over depends on where the price sits, and one
 * side can be unused entirely: above the range a position holds only token1, so
 * token0 buys nothing, and below it the reverse. Both cases return `0`, which
 * means "this side cannot fund a position here" rather than "deposit more".
 *
 * Floors, so the result never overstates what the amount covers. Pure and local.
 *
 * @param params The price, the range, and which side's amount is fixed.
 * @returns The liquidity that side supports (u128), floored, or `0` when the
 *   price puts that side out of use.
 *
 * @example
 * // 5 USDCx of token0, and what token1 must come with it:
 * const range = { sqrtLowerX128: sqrtLower, sqrtUpperX128: sqrtUpper }
 * const liquidity = liquidityForAmount({
 *   sqrtPriceX128: slot.sqrt_price,
 *   ...range,
 *   side: 0,
 *   amount: 5_000_000n,
 * })
 * const { amount1 } = amountsForLiquidity({
 *   sqrtPriceX128: slot.sqrt_price,
 *   ...range,
 *   liquidity,
 *   roundUp: true,
 * })
 */
export function liquidityForAmount(params: LiquidityForAmountParameters): bigint {
  const { sqrtPriceX128, side, amount } = params
  const lower = params.sqrtLowerX128 < params.sqrtUpperX128 ? params.sqrtLowerX128 : params.sqrtUpperX128
  const upper = params.sqrtLowerX128 < params.sqrtUpperX128 ? params.sqrtUpperX128 : params.sqrtLowerX128
  if (side === 0) {
    // Wholly below the range: the position is all token0, priced over its width.
    if (sqrtPriceX128 <= lower) return liquidityForAmount0(lower, upper, amount)
    // In range: token0 backs the upper half only, from the price to the top.
    if (sqrtPriceX128 < upper) return liquidityForAmount0(sqrtPriceX128, upper, amount)
    return 0n
  }
  if (sqrtPriceX128 >= upper) return liquidityForAmount1(lower, upper, amount)
  if (sqrtPriceX128 > lower) return liquidityForAmount1(lower, sqrtPriceX128, amount)
  return 0n
}

/**
 * Parameters for {@link liquidityForAmounts}.
 *
 * @property sqrtPriceX128 The pool's current sqrt price (`slot.sqrt_price`),
 *   Q128.128.
 * @property sqrtLowerX128 One range bound as a sqrt price, Q128.128. Bounds may
 *   arrive in either order — they are sorted internally.
 * @property sqrtUpperX128 The other range bound, Q128.128.
 * @property amount0 Raw base units of token0 available to deposit.
 * @property amount1 Raw base units of token1 available to deposit.
 */
export type LiquidityForAmountsParameters = {
  sqrtPriceX128: bigint
  sqrtLowerX128: bigint
  sqrtUpperX128: bigint
  amount0: bigint
  amount1: bigint
}

/**
 * Derives the liquidity a pair of token amounts supports over a range — the
 * inverse of {@link amountsForLiquidity}, and the direction a deposit starts
 * from.
 *
 * Which amount binds depends on where the price sits: at or below the range
 * only token0 is used, at or above it only token1, and inside the range the
 * smaller of the two sides governs, because liquidity must be backed on both.
 * Branch boundaries match the contract's (`price <= lower` counts as below).
 *
 * Every step floors, so the result is a lower bound. Feeding it back through
 * {@link amountsForLiquidity} with deposit-side rounding returns amounts that
 * do not exceed the ones passed here — which is what keeps a mint from
 * reverting for want of a base unit — and recovers the same liquidity rather
 * than drifting below it.
 *
 * Returns `0` when the amounts are dust relative to the range's width. Minting
 * against zero liquidity wastes a fee, so treat it as "deposit more" rather
 * than as a range to submit.
 *
 * Pure and local. Does not bound the result against the pool's
 * `max_liquidity_per_tick`; the contract enforces that.
 *
 * @param params The price, the range, and the amounts available on each side.
 * @returns The liquidity those amounts support (u128), floored.
 *
 * @example
 * const range = {
 *   sqrtPriceX128: slot.sqrt_price,
 *   sqrtLowerX128: getSqrtPriceAtTickX128(tickLower),
 *   sqrtUpperX128: getSqrtPriceAtTickX128(tickUpper),
 * }
 * const liquidity = liquidityForAmounts({ ...range, amount0: held0, amount1: held1 })
 * // What the mint will actually consume of each side:
 * const { amount0, amount1 } = amountsForLiquidity({ ...range, liquidity, roundUp: true })
 */
export function liquidityForAmounts(params: LiquidityForAmountsParameters): bigint {
  const { sqrtPriceX128, amount0, amount1 } = params
  const lower = params.sqrtLowerX128 < params.sqrtUpperX128 ? params.sqrtLowerX128 : params.sqrtUpperX128
  const upper = params.sqrtLowerX128 < params.sqrtUpperX128 ? params.sqrtUpperX128 : params.sqrtLowerX128
  if (sqrtPriceX128 <= lower) return liquidityForAmount0(lower, upper, amount0)
  if (sqrtPriceX128 < upper) {
    // In range both sides are consumed, so the shorter side caps the position.
    const from0 = liquidityForAmount0(sqrtPriceX128, upper, amount0)
    const from1 = liquidityForAmount1(lower, sqrtPriceX128, amount1)
    return from0 < from1 ? from0 : from1
  }
  return liquidityForAmount1(lower, upper, amount1)
}
