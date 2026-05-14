fn min_u128(a: u128, b: u128) -> u128 {
    return a < b ? a : b;
}

fn add_delta(x: u128, y: i128) -> u128 {
    return y < 0i128 ? x - (0i128 - y) as u128 : x + y as u128;
}

fn div_rounding_up(numerator: u128, denominator: u128) -> u128 {
    let result: u128 = numerator / denominator;
    let remainder: u128 = numerator % denominator;
    return remainder > 0u128 ? result + 1u128 : result;
}

program test_utils.aleo {
    @noupgrade
    constructor() {}

    @test
    fn test_div_exact() {
        let r: u128 = div_rounding_up(10u128, 2u128);
        assert_eq(r, 5u128);
    }

    @test
    fn test_div_round() {
        let r: u128 = div_rounding_up(10u128, 3u128);
        assert_eq(r, 4u128);
    }

    @test
    fn test_div_round_2() {
        let r: u128 = div_rounding_up(7u128, 2u128);
        assert_eq(r, 4u128);
    }

    @test
    fn test_min_first() {
        let r: u128 = min_u128(10u128, 20u128);
        assert_eq(r, 10u128);
    }

    @test
    fn test_min_second() {
        let r: u128 = min_u128(20u128, 10u128);
        assert_eq(r, 10u128);
    }

    @test
    fn test_min_equal() {
        let r: u128 = min_u128(10u128, 10u128);
        assert_eq(r, 10u128);
    }

    @test
    fn test_delta_pos() {
        let r: u128 = add_delta(100u128, 50i128);
        assert_eq(r, 150u128);
    }

    @test
    fn test_delta_neg() {
        let r: u128 = add_delta(100u128, -50i128);
        assert_eq(r, 50u128);
    }

    @test
    fn test_delta_zero() {
        let r: u128 = add_delta(100u128, 0i128);
        assert_eq(r, 100u128);
    }
}
