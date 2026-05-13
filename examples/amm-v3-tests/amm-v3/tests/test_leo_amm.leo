program test_leo_amm.aleo {
    @noupgrade
    constructor() {}

    @test
    fn test_sanity() {
        let x: u128 = 100u128;
        assert(x > 0u128);
    }
}
