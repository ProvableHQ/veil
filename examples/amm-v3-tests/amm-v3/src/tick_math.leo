// Q64 is the base for sqrt price representation (2^63)
// Using 2^63 keeps multiplications within u128 bounds (2^63 * 2^63 = 2^126 < 2^128)
const Q64: u128 = 9223372036854775808u128;  // 2^63

// Magic constants scaled for Q = 2^63
// MAGIC_n = floor(2^63 / sqrt(1.0001^n)) = floor(2^63 * 1.0001^(-n/2))
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

    let abs_tick_i32: i32=-1;


    if tick < 0i32 {
        abs_tick_i32 = 0i32 - tick;
    } else {
        abs_tick_i32 = tick;
    }

    assert(abs_tick_i32 >= 0i32);

    let abs_tick: u32 = abs_tick_i32 as u32;

    let low_bits: u32 = abs_tick & 0x3u32;
    let ratio: u128 = low_bits == 0u32 ? Q64 :
                      low_bits == 1u32 ? MAGIC_1 :
                      low_bits == 2u32 ? MAGIC_2 : START_3;

    // Bit 2 (value 4)
    if (abs_tick & 0x4u32 != 0u32) {
        ratio = (ratio * MAGIC_4) >> 63u8;
    }
    // Bit 3 (value 8)
    if (abs_tick & 0x8u32 != 0u32) {
        ratio = (ratio * MAGIC_8) >> 63u8;
    }
    // Bit 4 (value 16)
    if (abs_tick & 0x10u32 != 0u32) {
        ratio = (ratio * MAGIC_16) >> 63u8;
    }
    // Bit 5 (value 32)
    if (abs_tick & 0x20u32 != 0u32) {
        ratio = (ratio * MAGIC_32) >> 63u8;
    }
    // Bit 6 (value 64)
    if (abs_tick & 0x40u32 != 0u32) {
        ratio = (ratio * MAGIC_64) >> 63u8;
    }
    // Bit 7 (value 128)
    if (abs_tick & 0x80u32 != 0u32) {
        ratio = (ratio * MAGIC_128) >> 63u8;
    }
    // Bit 8 (value 256)
    if (abs_tick & 0x100u32 != 0u32) {
        ratio = (ratio * MAGIC_256) >> 63u8;
    }
    // Bit 9 (value 512)
    if (abs_tick & 0x200u32 != 0u32) {
        ratio = (ratio * MAGIC_512) >> 63u8;
    }
    // Bit 10 (value 1024)
    if (abs_tick & 0x400u32 != 0u32) {
        ratio = (ratio * MAGIC_1024) >> 63u8;
    }
    // Bit 11 (value 2048)
    if (abs_tick & 0x800u32 != 0u32) {
        ratio = (ratio * MAGIC_2048) >> 63u8;
    }
    // Bit 12 (value 4096)
    if (abs_tick & 0x1000u32 != 0u32) {
        ratio = (ratio * MAGIC_4096) >> 63u8;
    }
    // Bit 13 (value 8192)
    if (abs_tick & 0x2000u32 != 0u32) {
        ratio = (ratio * MAGIC_8192) >> 63u8;
    }
    // Bit 14 (value 16384)
    if (abs_tick & 0x4000u32 != 0u32) {
        ratio = (ratio * MAGIC_16384) >> 63u8;
    }
    // Bit 15 (value 32768)
    if (abs_tick & 0x8000u32 != 0u32) {
        ratio = (ratio * MAGIC_32768) >> 63u8;
    }
    // Bit 16 (value 65536)
    if (abs_tick & 0x10000u32 != 0u32) {
        ratio = (ratio * MAGIC_65536) >> 63u8;
    }
    // Bit 17 (value 131072)
    if (abs_tick & 0x20000u32 != 0u32) {
        ratio = (ratio * MAGIC_131072) >> 63u8;
    }
    // Bit 18 (value 262144)
    if (abs_tick & 0x40000u32 != 0u32) {
        ratio = (ratio * MAGIC_262144) >> 63u8;
    }
    // Bit 19 (value 524288)
    if (abs_tick & 0x80000u32 != 0u32) {
        ratio = (ratio * MAGIC_524288) >> 63u8;
    }

    // For positive ticks, we need the inverse: sqrt(1.0001^tick) = 1 / sqrt(1.0001^(-tick))
    // Q64 * Q64 = 2^126 which fits in u128 (max is ~2^128)
    if (tick > 0i32) {
        ratio = (Q64 * Q64) / ratio;
    }

    return ratio;
}

const LOG_SQRT_10001: i128 = 461184001294i128;  // log2(sqrt(1.0001)) * 2^64 / 2

// Get the tick corresponding to a sqrt price (Q64 format)
fn get_tick_at_sqrt_price(sqrt_price: u128) -> i32 {
    let msb: u32 = most_significant_bit(sqrt_price);
    let normalized: u128 = sqrt_price << (63u8 - msb as u8);
    let log2_frac: u128 = get_log2_fractional(normalized);
    // Use i128 to avoid overflow when log2_frac has bit 63 set
    let log2_shifted: i128 = ((msb as i128 - 63i128) << 64u8) + log2_frac as i128;
    let tick_estimate: i128 = log2_shifted / LOG_SQRT_10001;
    let tick: i32 = tick_estimate as i32;
    let sqrt_at_tick: u128 = get_sqrt_price_at_tick(tick);
    return sqrt_price < sqrt_at_tick ? tick - 1i32 : tick;
}

fn most_significant_bit(x: u128) -> u32 {
    let result: u32 = 0u32;
    let value: u128 = x;
    if (value >= 18446744073709551616u128) { value = value >> 64u8; result = result + 64u32; }
    if (value >= 4294967296u128) { value = value >> 32u8; result = result + 32u32; }
    if (value >= 65536u128) { value = value >> 16u8; result = result + 16u32; }
    if (value >= 256u128) { value = value >> 8u8; result = result + 8u32; }
    if (value >= 16u128) { value = value >> 4u8; result = result + 4u32; }
    if (value >= 4u128) { value = value >> 2u8; result = result + 2u32; }
    if (value >= 2u128) { result = result + 1u32; }
    return result;
}

fn get_log2_fractional(x: u128) -> u128 {
    let result: u128 = 0u128;
    let y: u128 = x;
    y = (y * y) >> 63u8; let b63: u128 = y >> 63u8; result = result | (b63 << 63u8); y = y >> b63 as u8;
    y = (y * y) >> 63u8; let b62: u128 = y >> 63u8; result = result | (b62 << 62u8); y = y >> b62 as u8;
    y = (y * y) >> 63u8; let b61: u128 = y >> 63u8; result = result | (b61 << 61u8); y = y >> b61 as u8;
    y = (y * y) >> 63u8; let b60: u128 = y >> 63u8; result = result | (b60 << 60u8); y = y >> b60 as u8;
    y = (y * y) >> 63u8; let b59: u128 = y >> 63u8; result = result | (b59 << 59u8); y = y >> b59 as u8;
    y = (y * y) >> 63u8; let b58: u128 = y >> 63u8; result = result | (b58 << 58u8); y = y >> b58 as u8;
    y = (y * y) >> 63u8; let b57: u128 = y >> 63u8; result = result | (b57 << 57u8); y = y >> b57 as u8;
    y = (y * y) >> 63u8; let b56: u128 = y >> 63u8; result = result | (b56 << 56u8);
    return result;
}
