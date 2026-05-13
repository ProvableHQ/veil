// H3 Finding: add_delta silently clamps liquidity underflow to zero.
//
// When x < |y| (subtraction would produce a negative result), add_delta
// returns 0 instead of panicking. This converts what should be a hard
// invariant violation into silent state corruption: a pool whose active
// liquidity underflows becomes liq=0 rather than failing visibly.
//
// Source: liquidity_math.leo::add_delta (lines 143-157)
//
// Real-world scenario: during an L4 spurious tick crossing, the pool's
// active liquidity is decremented by the full position amount, reaching 0.
// If a second spurious crossing occurs, add_delta(0, -L) returns 0 rather
// than panicking, masking the double-crossing bug entirely.

// Mirrors liquidity_math::add_delta exactly.
fn add_delta(x: u128, y: i128) -> u128 {
    let neg_y: i128 = 0i128 - y;

    let y_clamped: i128 = y > 0i128 ? y : 0i128;
    let neg_y_clamped: i128 = neg_y > 0i128 ? neg_y : 0i128;

    let y_pos: u128 = y_clamped as u128;
    let y_neg: u128 = neg_y_clamped as u128;

    let to_subtract: u128 = x < y_neg ? x : y_neg;
    let result_sub: u128 = x - to_subtract;

    let result_add: u128 = x + y_pos;

    return y < 0i128 ? result_sub : result_add;
}

program test_math_clamp_h3.aleo {
    @noupgrade
    constructor() {}

    // H3 core case: x=5, y=-10 → would underflow → silently returns 0
    @test
    fn test_clamps_small_underflow() {
        let result: u128 = add_delta(5u128, -10i128);
        // A runtime panic would be preferable: underflow signals a broken invariant.
        // Instead, add_delta silently returns 0.
        assert_eq(result, 0u128);
    }

    // H3: large underflow also silently returns 0
    @test
    fn test_clamps_large_underflow() {
        let result: u128 = add_delta(1u128, -1000000i128);
        assert_eq(result, 0u128);
    }

    // H3: exact underflow (x == |y|) produces 0, not a panic
    @test
    fn test_clamps_exact_underflow() {
        let result: u128 = add_delta(100u128, -100i128);
        assert_eq(result, 0u128);
    }

    // Baseline: normal subtraction (x > |y|) works correctly
    @test
    fn test_normal_subtraction() {
        let result: u128 = add_delta(100u128, -30i128);
        assert_eq(result, 70u128);
    }

    // Baseline: addition works correctly
    @test
    fn test_addition() {
        let result: u128 = add_delta(100u128, 50i128);
        assert_eq(result, 150u128);
    }

    // H3 + L4 interaction: double spurious crossing → second add_delta(0, -L) clamps
    @test
    fn test_second_crossing_after_underflow_clamps() {
        let initial_liq: u128 = 1000000u128;
        let liquidity_net: i128 = 1000000i128;  // tick's liquidity_net

        // First spurious crossing: subtract full liquidity_net
        let after_first: u128 = add_delta(initial_liq, 0i128 - liquidity_net);
        assert_eq(after_first, 0u128);  // liq hits 0

        // Second spurious crossing: add_delta(0, -L) clamps to 0 instead of panicking
        let after_second: u128 = add_delta(after_first, 0i128 - liquidity_net);
        assert_eq(after_second, 0u128);  // silent, no panic
    }
}
