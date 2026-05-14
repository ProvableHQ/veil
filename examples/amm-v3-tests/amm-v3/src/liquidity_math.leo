// Q64 is the base for sqrt price representation (2^63)
const Q64: u128 = 9223372036854775808u128;  // 2^63

// Q128 alias for backward compatibility (same as Q64)
const Q128: u128 = Q64; 


fn get_liquidity_for_amount0(sqrt_ratio_a: u128, sqrt_ratio_b: u128, amount0: u128) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b
        ? (sqrt_ratio_b, sqrt_ratio_a)
        : (sqrt_ratio_a, sqrt_ratio_b);


    let intermediate: u128 = (lower * upper) / Q64;

    let liquidity: u128 = (amount0 * intermediate) / (upper - lower);

    return liquidity;
}


fn get_liquidity_for_amount1(sqrt_ratio_a: u128, sqrt_ratio_b: u128, amount1: u128) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b
        ? (sqrt_ratio_b, sqrt_ratio_a)
        : (sqrt_ratio_a, sqrt_ratio_b);

    let diff: u128 = upper - lower;
    let liquidity: u128 = (amount1 / diff) * Q64 + ((amount1 % diff) * Q64) / diff;

    return liquidity;
}

fn get_liquidity_for_amounts(
    sqrt_ratio: u128,
    sqrt_ratio_a: u128,
    sqrt_ratio_b: u128,
    amount0: u128,
    amount1: u128
) -> u128 {

    // Sort sqrt_ratio_a and sqrt_ratio_b using if/else to avoid ternary evaluation issues
    let lower: u128 = 0u128;
    let upper: u128 = 0u128;
    if sqrt_ratio_a > sqrt_ratio_b {
        lower = sqrt_ratio_b;
        upper = sqrt_ratio_a;
    } else {
        lower = sqrt_ratio_a;
        upper = sqrt_ratio_b;
    }

    // Calculate liquidity based on current price position relative to range
    // Using if/else to avoid Leo's ternary branch evaluation issue
    let liquidity: u128 = 0u128;
    if sqrt_ratio <= lower {
        // Price is below range - all liquidity is in token0
        liquidity = get_liquidity_for_amount0(lower, upper, amount0);
    } else if sqrt_ratio < upper {
        // Price is within range - use minimum of both calculations
        let liq0: u128 = get_liquidity_for_amount0(sqrt_ratio, upper, amount0);
        let liq1: u128 = get_liquidity_for_amount1(lower, sqrt_ratio, amount1);
        if liq0 < liq1 {
            liquidity = liq0;
        } else {
            liquidity = liq1;
        }
    } else {
        // Price is above range - all liquidity is in token1
        liquidity = get_liquidity_for_amount1(lower, upper, amount1);
    }

    return liquidity;
}


fn get_amount0_for_liquidity(sqrt_ratio_a: u128, sqrt_ratio_b: u128, liquidity: u128) -> u128 {
    // Ensure a < b
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b
        ? (sqrt_ratio_b, sqrt_ratio_a)
        : (sqrt_ratio_a, sqrt_ratio_b);

    let amount0: u128 = ((liquidity * (upper - lower)) / upper) * Q64 / lower;

    return amount0;
}


fn get_amount1_for_liquidity(sqrt_ratio_a: u128, sqrt_ratio_b: u128, liquidity: u128) -> u128 {
    // Ensure a < b
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b
        ? (sqrt_ratio_b, sqrt_ratio_a)
        : (sqrt_ratio_a, sqrt_ratio_b);


    let amount1: u128 = (liquidity * (upper - lower)) / Q64;

    return amount1;
}

fn get_amounts_for_liquidity(
    sqrt_ratio: u128,
    sqrt_ratio_a: u128,
    sqrt_ratio_b: u128,
    liquidity: u128
) -> (u128, u128) {
    // Sort sqrt_ratio_a and sqrt_ratio_b using if/else to avoid ternary evaluation issues
    let lower: u128 = 0u128;
    let upper: u128 = 0u128;
    if sqrt_ratio_a > sqrt_ratio_b {
        lower = sqrt_ratio_b;
        upper = sqrt_ratio_a;
    } else {
        lower = sqrt_ratio_a;
        upper = sqrt_ratio_b;
    }

    // Calculate amounts based on current price position relative to range
    // Using if/else to avoid Leo's ternary branch evaluation issue
    let amount0: u128 = 0u128;
    let amount1: u128 = 0u128;
    if sqrt_ratio <= lower {
        // Price is below range - all liquidity is in token0
        amount0 = get_amount0_for_liquidity(lower, upper, liquidity);
        amount1 = 0u128;
    } else if sqrt_ratio < upper {
        // Price is within range - has both tokens
        amount0 = get_amount0_for_liquidity(sqrt_ratio, upper, liquidity);
        amount1 = get_amount1_for_liquidity(lower, sqrt_ratio, liquidity);
    } else {
        // Price is above range - all liquidity is in token1
        amount0 = 0u128;
        amount1 = get_amount1_for_liquidity(lower, upper, liquidity);
    }

    return (amount0, amount1);
}


fn min_u128(a: u128, b: u128) -> u128 {
    return a < b ? a : b;
}

fn add_delta(x: u128, y: i128) -> u128 {
    let neg_y: i128 = 0i128 - y;

    let y_clamped: i128 = y > 0i128 ? y : 0i128;           // positive y, or 0
    let neg_y_clamped: i128 = neg_y > 0i128 ? neg_y : 0i128; // |y| when y < 0, or 0
    
    let y_pos: u128 = y_clamped as u128;
    let y_neg: u128 = neg_y_clamped as u128;
    
    let to_subtract: u128 = x < y_neg ? x : y_neg;
    let result_sub: u128 = x - to_subtract;
    
    let result_add: u128 = x + y_pos;
    
    return y < 0i128 ? result_sub : result_add;
}