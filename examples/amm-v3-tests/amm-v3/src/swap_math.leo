// Q64 is the base for sqrt price representation (2^63)
const Q64: u128 = 9223372036854775808u128;  // 2^63

// Compute swap step: given current state and target price, compute amounts and new price
// Returns (sqrt_price_next, amount_in, amount_out, fee_amount)
fn compute_swap_step(
    sqrt_price_current: u128,
    sqrt_price_target: u128,
    liquidity: u128,
    amount_remaining: u128,
    fee_pips: u32,  // fee in hundredths of a bip (e.g., 3000 = 0.3%)
    zero_for_one: bool
) -> (u128, u128, u128, u128) {

    let amount_in_max: u128 = zero_for_one
        ? get_amount0_delta(sqrt_price_target, sqrt_price_current, liquidity, true)
        : get_amount1_delta(sqrt_price_current, sqrt_price_target, liquidity, true);

    let amount_remaining_less_fee: u128 = (amount_remaining * (1000000u128 - fee_pips as u128)) / 1000000u128;

    let reaches_target: bool = amount_remaining_less_fee >= amount_in_max;

    let sqrt_price_next: u128 = reaches_target
        ? sqrt_price_target
        : get_next_sqrt_price_from_input(sqrt_price_current, liquidity, amount_remaining_less_fee, zero_for_one);

    let amount_in: u128 = reaches_target
        ? amount_in_max
        : (zero_for_one
            ? get_amount0_delta(sqrt_price_next, sqrt_price_current, liquidity, true)
            : get_amount1_delta(sqrt_price_current, sqrt_price_next, liquidity, true));

    let amount_out: u128 = zero_for_one
        ? get_amount1_delta(sqrt_price_next, sqrt_price_current, liquidity, false)
        : get_amount0_delta(sqrt_price_current, sqrt_price_next, liquidity, false);

    let fee_amount: u128 = reaches_target
        ? div_rounding_up(amount_in * fee_pips as u128, 1000000u128 - fee_pips as u128)
        : amount_remaining - amount_in;

    return (sqrt_price_next, amount_in, amount_out, fee_amount);
}

// Get amount0 delta between two sqrt prices for a given liquidity
// round_up: true for amounts going in, false for amounts going out
fn get_amount0_delta(sqrt_ratio_a: u128, sqrt_ratio_b: u128, liquidity: u128, round_up: bool) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b
        ? (sqrt_ratio_b, sqrt_ratio_a)
        : (sqrt_ratio_a, sqrt_ratio_b);

    // Guard against zero liquidity or same prices
    let diff: u128 = upper - lower;
    let numerator: u128 = liquidity * diff;
    let denominator: u128 = lower > 0u128 && upper > 0u128 ? (lower * upper) / Q64 : 1u128;

    // Guard against zero denominator
    let result: u128 = denominator > 0u128
        ? (round_up ? div_rounding_up(numerator, denominator) : numerator / denominator)
        : 0u128;

    return result;
}

// Get amount1 delta between two sqrt prices for a given liquidity
fn get_amount1_delta(sqrt_ratio_a: u128, sqrt_ratio_b: u128, liquidity: u128, round_up: bool) -> u128 {
    let (lower, upper) = sqrt_ratio_a > sqrt_ratio_b
        ? (sqrt_ratio_b, sqrt_ratio_a)
        : (sqrt_ratio_a, sqrt_ratio_b);

    let diff: u128 = upper - lower;
    let result: u128 = round_up
        ? div_rounding_up(liquidity * diff, Q64)
        : (liquidity * diff) / Q64;

    return result;
}

// Calculate next sqrt price given an input amount
fn get_next_sqrt_price_from_input(
    sqrt_price: u128,
    liquidity: u128,
    amount_in: u128,
    zero_for_one: bool
) -> u128 {
    // For token0 input (zero_for_one = true):
    // sqrt_price_next = sqrt_price * L / (L + amount_in * sqrt_price)
    // For token1 input (zero_for_one = false):
    // sqrt_price_next = sqrt_price + amount_in * Q64 / L

    let result: u128 = zero_for_one
        ? next_sqrt_price_from_amt0(sqrt_price, liquidity, amount_in, true)
        : next_sqrt_price_from_amt1(sqrt_price, liquidity, amount_in, true);

    return result;
}

// Calculate next sqrt price from amount0 input/output
fn next_sqrt_price_from_amt0(
    sqrt_price: u128,
    liquidity: u128,
    amount: u128,
    add: bool  // true if adding token0 (price goes down)
) -> u128 {
    // When adding token0: sqrt_price_next = L * sqrt_price / (L + amount * sqrt_price / Q64)
    // When removing token0: sqrt_price_next = L * sqrt_price / (L - amount * sqrt_price / Q64)

    let product: u128 = (amount * sqrt_price) / Q64;

    let denominator: u128 = add
        ? liquidity + product
        : liquidity - product;

    let result: u128 = (liquidity * sqrt_price) / denominator;

    return result;
}

// Calculate next sqrt price from amount1 input/output
fn next_sqrt_price_from_amt1(
    sqrt_price: u128,
    liquidity: u128,
    amount: u128,
    add: bool  // true if adding token1 (price goes up)
) -> u128 {
    // When adding token1: sqrt_price_next = sqrt_price + amount * Q64 / L
    // When removing token1: sqrt_price_next = sqrt_price - amount * Q64 / L

    // Guard against division by zero
    let delta: u128 = liquidity > 0u128 ? (amount * Q64) / liquidity : 0u128;

    let result: u128 = add
        ? sqrt_price + delta
        : sqrt_price - delta;

    return result;
}

// Division with rounding up
fn div_rounding_up(numerator: u128, denominator: u128) -> u128 {
    let result: u128 = numerator / denominator;
    let remainder: u128 = numerator % denominator;

    return remainder > 0u128 ? result + 1u128 : result;
}

// Multiply and divide with better precision (for fee calculations)
fn mul_div(a: u128, b: u128, denominator: u128) -> u128 {
    return (a * b) / denominator;
}

fn mul_div_rounding_up(a: u128, b: u128, denominator: u128) -> u128 {
    let result: u128 = (a * b) / denominator;
    let remainder: u128 = (a * b) % denominator;

    return remainder > 0u128 ? result + 1u128 : result;
}
