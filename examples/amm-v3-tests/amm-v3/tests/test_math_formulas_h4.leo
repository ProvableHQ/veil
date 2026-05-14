// H4 Finding: get_amount0_for_liquidity (liquidity_math) and get_amount0_delta
// (swap_math) use different formulas to compute the token0 amount for a given
// (lower, upper, liquidity) triple. Due to different truncation orders, they
// produce inconsistent results for identical inputs.
//
// H1 is a sub-finding: swap_math's formula truncates the denominator first
// (floor(lower*upper/Q64)), making the denominator smaller, so the resulting
// token0 amount is >= the exact value. LPs pay more token0 than the
// mathematically exact amount.
//
// Source:
//   swap_math.leo::get_amount0_delta     (line 54)
//   liquidity_math.leo::get_amount0_for_liquidity (line 82)
//
// swap_math formula:
//   numerator   = liquidity * (upper - lower)
//   denominator = floor(lower * upper / Q64)    ← TRUNCATES DENOMINATOR
//   result      = ceil(numerator / denominator)  (round_up=true for amount_in)
//
// liquidity_math formula:
//   step1  = floor(liquidity * (upper - lower) / upper)  ← TRUNCATES NUMERATOR STEP
//   result = step1 * Q64 / lower

const Q64: u128 = 9223372036854775808u128;  // 2^63

// Magic constants for get_sqrt_price_at_tick (from test_liq_math.leo)
const MAGIC_1: u128 = 9222910902837697536u128;
const MAGIC_2: u128 = 9222449791875588096u128;
const MAGIC_4: u128 = 9221527639111677952u128;
const MAGIC_8: u128 = 9219683610192801792u128;
const MAGIC_16: u128 = 9215996658532725760u128;
const MAGIC_32: u128 = 9208627177859081216u128;
const MAGIC_64: u128 = 9193905890596798464u128;
const MAGIC_128: u128 = 9164533880601766912u128;
const MAGIC_256: u128 = 9106071067403056128u128;
const MAGIC_512: u128 = 8990261907820801024u128;
const MAGIC_1024: u128 = 8763043369415622656u128;
const MAGIC_2048: u128 = 8325689215117605888u128;
const MAGIC_4096: u128 = 7515375139346884608u128;
const MAGIC_8192: u128 = 6123667489441693696u128;
const MAGIC_16384: u128 = 4065682634442729984u128;
const MAGIC_32768: u128 = 1792161827361994496u128;
const MAGIC_65536: u128 = 348228825923923264u128;
const MAGIC_131072: u128 = 13147394978735516u128;
const MAGIC_262144: u128 = 18740867660568u128;
const MAGIC_524288: u128 = 38079361u128;
const START_3: u128 = 9221988703967300608u128;

fn get_sqrt_price_at_tick(tick: i32) -> u128 {
    let abs_tick: u32 = tick < 0i32 ? (0i32 - tick) as u32 : tick as u32;
    let low_bits: u32 = abs_tick & 0x3u32;
    let ratio: u128 = low_bits == 0u32 ? Q64 :
                      low_bits == 1u32 ? MAGIC_1 :
                      low_bits == 2u32 ? MAGIC_2 : START_3;

    if (abs_tick & 0x4u32 != 0u32) { ratio = (ratio * MAGIC_4) >> 63u8; }
    if (abs_tick & 0x8u32 != 0u32) { ratio = (ratio * MAGIC_8) >> 63u8; }
    if (abs_tick & 0x10u32 != 0u32) { ratio = (ratio * MAGIC_16) >> 63u8; }
    if (abs_tick & 0x20u32 != 0u32) { ratio = (ratio * MAGIC_32) >> 63u8; }
    if (abs_tick & 0x40u32 != 0u32) { ratio = (ratio * MAGIC_64) >> 63u8; }
    if (abs_tick & 0x80u32 != 0u32) { ratio = (ratio * MAGIC_128) >> 63u8; }
    if (abs_tick & 0x100u32 != 0u32) { ratio = (ratio * MAGIC_256) >> 63u8; }
    if (abs_tick & 0x200u32 != 0u32) { ratio = (ratio * MAGIC_512) >> 63u8; }
    if (abs_tick & 0x400u32 != 0u32) { ratio = (ratio * MAGIC_1024) >> 63u8; }
    if (abs_tick & 0x800u32 != 0u32) { ratio = (ratio * MAGIC_2048) >> 63u8; }
    if (abs_tick & 0x1000u32 != 0u32) { ratio = (ratio * MAGIC_4096) >> 63u8; }
    if (abs_tick & 0x2000u32 != 0u32) { ratio = (ratio * MAGIC_8192) >> 63u8; }
    if (abs_tick & 0x4000u32 != 0u32) { ratio = (ratio * MAGIC_16384) >> 63u8; }
    if (abs_tick & 0x8000u32 != 0u32) { ratio = (ratio * MAGIC_32768) >> 63u8; }
    if (abs_tick & 0x10000u32 != 0u32) { ratio = (ratio * MAGIC_65536) >> 63u8; }
    if (abs_tick & 0x20000u32 != 0u32) { ratio = (ratio * MAGIC_131072) >> 63u8; }
    if (abs_tick & 0x40000u32 != 0u32) { ratio = (ratio * MAGIC_262144) >> 63u8; }
    if (abs_tick & 0x80000u32 != 0u32) { ratio = (ratio * MAGIC_524288) >> 63u8; }

    if (tick > 0i32) {
        ratio = (Q64 * Q64) / ratio;
    }
    return ratio;
}

fn div_rounding_up(numerator: u128, denominator: u128) -> u128 {
    let result: u128 = numerator / denominator;
    let remainder: u128 = numerator % denominator;
    return remainder > 0u128 ? result + 1u128 : result;
}

// Mirrors swap_math::get_amount0_delta (round_up=true variant used for amount_in)
fn amount0_swap_math(lower: u128, upper: u128, liquidity: u128) -> u128 {
    let diff: u128 = upper - lower;
    let numerator: u128 = liquidity * diff;
    let denominator: u128 = lower > 0u128 && upper > 0u128 ? (lower * upper) / Q64 : 1u128;
    return denominator > 0u128 ? div_rounding_up(numerator, denominator) : 0u128;
}

// Mirrors liquidity_math::get_amount0_for_liquidity
fn amount0_liq_math(lower: u128, upper: u128, liquidity: u128) -> u128 {
    return ((liquidity * (upper - lower)) / upper) * Q64 / lower;
}

program test_math_formulas_h4.aleo {
    @noupgrade
    constructor() {}

    // H4: the two functions produce different results for the same (lower, upper, liquidity).
    // tick range [-600, 600] with a typical liquidity value.
    @test
    fn test_h4_formula_inconsistency_tick_range_600() {
        let lower: u128 = get_sqrt_price_at_tick(-600i32);
        let upper: u128 = get_sqrt_price_at_tick(600i32);
        let liquidity: u128 = 1000000000000u128;  // 1e12

        let amt0_swap: u128 = amount0_swap_math(lower, upper, liquidity);
        let amt0_liq: u128 = amount0_liq_math(lower, upper, liquidity);

        // Different truncation order → different results
        assert(amt0_swap != amt0_liq);
    }

    // H1: swap_math's formula (denominator truncated) gives >= liq_math result.
    // Meaning: when an LP mints a position, they are charged at least as much token0
    // as liq_math would suggest, often slightly more.
    @test
    fn test_h1_swap_math_charges_more_token0() {
        let lower: u128 = get_sqrt_price_at_tick(-600i32);
        let upper: u128 = get_sqrt_price_at_tick(600i32);
        let liquidity: u128 = 1000000000000u128;

        let amt0_swap: u128 = amount0_swap_math(lower, upper, liquidity);
        let amt0_liq: u128 = amount0_liq_math(lower, upper, liquidity);

        // swap_math truncates denominator first → smaller denominator → larger amount
        assert(amt0_swap >= amt0_liq);
    }

    // H4: also holds for a wider tick range [-1000, 1000]
    @test
    fn test_h4_formula_inconsistency_tick_range_1000() {
        let lower: u128 = get_sqrt_price_at_tick(-1000i32);
        let upper: u128 = get_sqrt_price_at_tick(1000i32);
        let liquidity: u128 = 500000000000u128;

        let amt0_swap: u128 = amount0_swap_math(lower, upper, liquidity);
        let amt0_liq: u128 = amount0_liq_math(lower, upper, liquidity);

        assert(amt0_swap != amt0_liq);
    }

    // H4: for an asymmetric range below tick 0 (price below range → all token0)
    @test
    fn test_h4_formula_inconsistency_range_below_zero() {
        let lower: u128 = get_sqrt_price_at_tick(-2000i32);
        let upper: u128 = get_sqrt_price_at_tick(-100i32);
        let liquidity: u128 = 2000000000000u128;

        let amt0_swap: u128 = amount0_swap_math(lower, upper, liquidity);
        let amt0_liq: u128 = amount0_liq_math(lower, upper, liquidity);

        assert(amt0_swap != amt0_liq);
    }
}
