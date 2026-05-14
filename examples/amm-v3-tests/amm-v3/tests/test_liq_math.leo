// Q64 = 2^63 (matches main contract)
const Q64: u128 = 9223372036854775808u128;  // 2^63

// Magic constants scaled for Q = 2^63 (from main contract)
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

fn get_liquidity_for_amount0(sqrt_ratio_a: u128, sqrt_ratio_b: u128, amount0: u128) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b ? (sqrt_ratio_b, sqrt_ratio_a) : (sqrt_ratio_a, sqrt_ratio_b);
    let intermediate: u128 = (lower * upper) / Q64;
    return (amount0 * intermediate) / (upper - lower);
}

fn get_liquidity_for_amount1(sqrt_ratio_a: u128, sqrt_ratio_b: u128, amount1: u128) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b ? (sqrt_ratio_b, sqrt_ratio_a) : (sqrt_ratio_a, sqrt_ratio_b);
    let diff: u128 = upper - lower;
    return (amount1 / diff) * Q64 + ((amount1 % diff) * Q64) / diff;
}

fn get_liquidity_for_amounts(sqrt_ratio: u128, sqrt_ratio_a: u128, sqrt_ratio_b: u128, amount0: u128, amount1: u128) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b ? (sqrt_ratio_b, sqrt_ratio_a) : (sqrt_ratio_a, sqrt_ratio_b);
    return sqrt_ratio <= lower
        ? get_liquidity_for_amount0(lower, upper, amount0)
        : (sqrt_ratio < upper
            ? min_u128(get_liquidity_for_amount0(sqrt_ratio, upper, amount0), get_liquidity_for_amount1(lower, sqrt_ratio, amount1))
            : get_liquidity_for_amount1(lower, upper, amount1));
}

fn get_amount0_for_liquidity(sqrt_ratio_a: u128, sqrt_ratio_b: u128, liquidity: u128) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b ? (sqrt_ratio_b, sqrt_ratio_a) : (sqrt_ratio_a, sqrt_ratio_b);
    return ((liquidity * (upper - lower)) / upper) * Q64 / lower;
}

fn get_amount1_for_liquidity(sqrt_ratio_a: u128, sqrt_ratio_b: u128, liquidity: u128) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b ? (sqrt_ratio_b, sqrt_ratio_a) : (sqrt_ratio_a, sqrt_ratio_b);
    return (liquidity * (upper - lower)) / Q64;
}

fn get_amounts_for_liquidity(sqrt_ratio: u128, sqrt_ratio_a: u128, sqrt_ratio_b: u128, liquidity: u128) -> (u128, u128) {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b ? (sqrt_ratio_b, sqrt_ratio_a) : (sqrt_ratio_a, sqrt_ratio_b);
    return sqrt_ratio <= lower
        ? (get_amount0_for_liquidity(lower, upper, liquidity), 0u128)
        : (sqrt_ratio < upper
            ? (get_amount0_for_liquidity(sqrt_ratio, upper, liquidity), get_amount1_for_liquidity(lower, sqrt_ratio, liquidity))
            : (0u128, get_amount1_for_liquidity(lower, upper, liquidity)));
}

fn min_u128(a: u128, b: u128) -> u128 {
    return a < b ? a : b;
}

program test_liq_math.aleo {
    @noupgrade
    constructor() {}

    @test
    fn test_liq_for_amt0() {
        let sqrt_lower: u128 = get_sqrt_price_at_tick(-1000i32);
        let sqrt_upper: u128 = get_sqrt_price_at_tick(0i32);
        let liq: u128 = get_liquidity_for_amount0(sqrt_lower, sqrt_upper, 1000000u128);
        assert(liq > 0u128);
    }

    @test
    fn test_liq_for_amt1() {
        let sqrt_lower: u128 = get_sqrt_price_at_tick(0i32);
        let sqrt_upper: u128 = get_sqrt_price_at_tick(1000i32);
        let liq: u128 = get_liquidity_for_amount1(sqrt_lower, sqrt_upper, 1000000u128);
        assert(liq > 0u128);
    }

    @test
    fn test_liq_in_range() {
        let sqrt_lower: u128 = get_sqrt_price_at_tick(-1000i32);
        let sqrt_upper: u128 = get_sqrt_price_at_tick(1000i32);
        let sqrt_current: u128 = get_sqrt_price_at_tick(0i32);
        let liq: u128 = get_liquidity_for_amounts(sqrt_current, sqrt_lower, sqrt_upper, 1000000u128, 1000000u128);
        assert(liq > 0u128);
    }

    @test
    fn test_liq_below_range() {
        let sqrt_lower: u128 = get_sqrt_price_at_tick(100i32);
        let sqrt_upper: u128 = get_sqrt_price_at_tick(1000i32);
        let sqrt_current: u128 = get_sqrt_price_at_tick(0i32);
        let liq: u128 = get_liquidity_for_amounts(sqrt_current, sqrt_lower, sqrt_upper, 1000000u128, 1000000u128);
        let liq_from_0: u128 = get_liquidity_for_amount0(sqrt_lower, sqrt_upper, 1000000u128);
        assert_eq(liq, liq_from_0);
    }

    @test
    fn test_amt0_for_liq() {
        let sqrt_lower: u128 = get_sqrt_price_at_tick(-1000i32);
        let sqrt_upper: u128 = get_sqrt_price_at_tick(0i32);
        let amt0: u128 = get_amount0_for_liquidity(sqrt_lower, sqrt_upper, 1000000000u128);
        assert(amt0 > 0u128);
    }

    @test
    fn test_amt1_for_liq() {
        let sqrt_lower: u128 = get_sqrt_price_at_tick(0i32);
        let sqrt_upper: u128 = get_sqrt_price_at_tick(1000i32);
        let amt1: u128 = get_amount1_for_liquidity(sqrt_lower, sqrt_upper, 1000000000u128);
        assert(amt1 > 0u128);
    }

    @test
    fn test_zero_liq() {
        let sqrt_lower: u128 = get_sqrt_price_at_tick(-1000i32);
        let sqrt_upper: u128 = get_sqrt_price_at_tick(1000i32);
        let sqrt_current: u128 = get_sqrt_price_at_tick(0i32);
        let (amt0, amt1): (u128, u128) = get_amounts_for_liquidity(sqrt_current, sqrt_lower, sqrt_upper, 0u128);
        assert_eq(amt0, 0u128);
        assert_eq(amt1, 0u128);
    }
}
