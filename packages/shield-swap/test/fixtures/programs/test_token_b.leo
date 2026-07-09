// Test Token B — STANDALONE ARC-20 token (18 decimals).
//
// No token_registry, no credits, no wrapping. Supply is created directly by the
// admin via mint_public. All balances live in this program's own `balances`
// mapping. shield_v001 reads `decimals()` on pool creation via dynamic dispatch
// (must be a regular `fn`, not `view fn` — snarkVM can't call.dynamic a view fn).




const ADMIN: address = aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px;
struct TokenAllowance { account: address, spender: address }

program test_token_b.aleo {

    // Only this address may mint. Baked in at deploy time (the test admin/deployer).

    record Token { owner: address, amount: u128 }

    mapping balances: address => u128;
    mapping allowances: TokenAllowance => u128;

    @noupgrade
    constructor() {}

    // 6-decimal asset. The swap-mechanics test suite uses a SYMMETRIC 6/6 pool
    // (TOKA + TOKB both 6) so liquidity/amounts are balanced; 18-decimal
    // (asymmetric, scale=10^9) behaviour is exercised by the dedicated decimal
    // tests, not the generic swap suite.
    fn decimals() -> u8 {
        return 6u8;
    }

    // ── Supply (admin-gated mint) ───────────────────────────────────
    fn mint_public(public recipient: address, public amount: u128) -> Final {
        assert_eq(self.signer, ADMIN);
        return final {
            let b: u128 = Mapping::get_or_use(balances, recipient, 0u128);
            balances.set(recipient, b + amount);
        };
    }

    // ── ARC-20 ───────────────────────────────────────────────────────

    fn transfer_public(public recipient: address, public amount: u128) -> Final {
        let c: address = self.caller;
        return final {
            let cb: u128 = balances.get(c); balances.set(c, cb - amount);
            let rb: u128 = Mapping::get_or_use(balances, recipient, 0u128); balances.set(recipient, rb + amount);
        };
    }

    fn transfer_public_as_signer(public recipient: address, public amount: u128) -> Final {
        let s: address = self.signer;
        return final {
            let sb: u128 = balances.get(s); balances.set(s, sb - amount);
            let rb: u128 = Mapping::get_or_use(balances, recipient, 0u128); balances.set(recipient, rb + amount);
        };
    }

    fn transfer_private(input: Token, to: address, amount: u128) -> (Token, Token) {
        assert(input.owner == self.signer);
        return (Token { owner: input.owner, amount: input.amount - amount }, Token { owner: to, amount });
    }

    fn transfer_private_to_public(input: Token, public to: address, public amount: u128) -> (Token, Final) {
        assert(input.owner == self.signer);
        return (
            Token { owner: input.owner, amount: input.amount - amount },
            final { let b: u128 = Mapping::get_or_use(balances, to, 0u128); balances.set(to, b + amount); }
        );
    }

    fn transfer_public_to_private(recipient: address, public amount: u128) -> (Token, Final) {
        let c: address = self.caller;
        return (Token { owner: recipient, amount }, final { let b: u128 = balances.get(c); balances.set(c, b - amount); });
    }

    fn approve_public(public spender: address, public amount: u128) -> Final {
        let key: TokenAllowance = TokenAllowance { account: self.caller, spender };
        return final { let c: u128 = Mapping::get_or_use(allowances, key, 0u128); allowances.set(key, c + amount); };
    }

    fn unapprove_public(public spender: address, public amount: u128) -> Final {
        let key: TokenAllowance = TokenAllowance { account: self.caller, spender };
        return final { let c: u128 = allowances.get(key); allowances.set(key, c - amount); };
    }

    fn transfer_from_public(public owner: address, public recipient: address, public amount: u128) -> Final {
        let key: TokenAllowance = TokenAllowance { account: owner, spender: self.caller };
        return final {
            let a: u128 = allowances.get(key); assert(a >= amount); allowances.set(key, a - amount);
            let ob: u128 = balances.get(owner); balances.set(owner, ob - amount);
            let rb: u128 = Mapping::get_or_use(balances, recipient, 0u128); balances.set(recipient, rb + amount);
        };
    }

    fn transfer_from_public_to_private(public owner: address, public amount: u128) -> (Token, Final) {
        let spender: address = self.caller;
        let key: TokenAllowance = TokenAllowance { account: owner, spender };
        return (Token { owner: spender, amount }, final {
            let a: u128 = allowances.get(key); assert(a >= amount); allowances.set(key, a - amount);
            let ob: u128 = balances.get(owner); balances.set(owner, ob - amount);
        });
    }
}
