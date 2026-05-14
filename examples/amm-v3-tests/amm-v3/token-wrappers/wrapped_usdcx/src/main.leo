// Wrapped USDCx — ARC-20 wrapper over test_usdcx_stablecoin.aleo.
//
// Public deposit/withdraw bridge to the stablecoin.
// Private withdraw supported (transfer_public_to_private has no MerkleProof).
// Private deposit NOT supported — transfer_private_to_public requires MerkleProofs
// from the stablecoin's freeze list, which is beyond this wrapper's scope.

import test_usdcx_stablecoin.aleo;

interface ARC20 {
    record Token;
    record Metadata;

    fn transfer_public(public recipient: address, public amount: u128) -> Final;
    fn transfer_private(input: Token, to: address, amount: u128) -> (Token, Token);
    fn transfer_private_to_public(input: Token, to: address, amount: u128) -> (Token, Metadata, Final);
    fn transfer_public_to_private(recipient: address, public amount: u128) -> (Token, Final);
    fn shield(public amount: u128) -> (Token, Final);
    fn unshield(input: Token, amount: u128) -> (Token, Token, Final);
    fn approve_public(public spender: address, public amount: u128) -> Final;
    fn unapprove_public(public spender: address, public amount: u128) -> Final;
    fn transfer_from_public(public owner: address, public recipient: address, public amount: u128) -> Final;
    fn transfer_from_public_to_private(public owner: address, public amount: u128) -> (Token, Final);
}

program wrapped_usdcx.aleo: ARC20 {

    record Token { owner: address, amount: u128 }
    record Metadata { owner: address }
    struct TokenAllowance { account: address, spender: address }

    mapping balances: address => u128;
    mapping allowances: TokenAllowance => u128;

    @noupgrade
    constructor() {}

    // ── Bridging (test_usdcx_stablecoin.aleo) ───────────────────────

    fn deposit_public(public amount: u128) -> Final {
        let depositor: address = self.signer;
        let f: Final = test_usdcx_stablecoin.aleo::transfer_public_as_signer(self.address, amount);
        return final {
            f.run();
            let b: u128 = Mapping::get_or_use(balances, depositor, 0u128);
            balances.set(depositor, b + amount);
        };
    }

    fn withdraw_public(public amount: u128) -> Final {
        let w: address = self.caller;
        let f: Final = test_usdcx_stablecoin.aleo::transfer_public(w, amount);
        return final {
            let b: u128 = balances.get(w);
            balances.set(w, b - amount);
            f.run();
        };
    }

    fn withdraw_public_signer(public amount: u128) -> Final {
        let w: address = self.signer;
        let f: Final = test_usdcx_stablecoin.aleo::transfer_public(w, amount);
        return final {
            let b: u128 = balances.get(w);
            balances.set(w, b - amount);
            f.run();
        };
    }

    fn deposit_private(
        input: test_usdcx_stablecoin.aleo::Token,
        amount: u128,
        proofs: [test_usdcx_stablecoin.aleo::MerkleProof; 2],
    ) -> (test_usdcx_stablecoin.aleo::Token, Final) {
        let depositor: address = self.signer;
        let (compliance, change, f) = test_usdcx_stablecoin.aleo::transfer_private_to_public(self.address, amount, input, proofs);
        return (change, final {
            f.run();
            let b: u128 = Mapping::get_or_use(balances, depositor, 0u128);
            balances.set(depositor, b + amount);
        });
    }

    fn withdraw_private(public amount: u128) -> (test_usdcx_stablecoin.aleo::Token, Final) {
        let w: address = self.signer;
        let (compliance, output, f) = test_usdcx_stablecoin.aleo::transfer_public_to_private(w, amount);
        return (output, final {
            let b: u128 = balances.get(w);
            balances.set(w, b - amount);
            f.run();
        });
    }

    // ── ARC-20 ───────────────────────────────────────────────────────

    fn transfer_public(public recipient: address, public amount: u128) -> Final {
        let c: address = self.caller;
        return final {
            let cb: u128 = balances.get(c); balances.set(c, cb - amount);
            let rb: u128 = Mapping::get_or_use(balances, recipient, 0u128); balances.set(recipient, rb + amount);
        };
    }

    fn transfer_private(input: Token, to: address, amount: u128) -> (Token, Token) {
        assert(input.owner == self.signer);
        return (Token { owner: input.owner, amount: input.amount - amount }, Token { owner: to, amount });
    }

    fn transfer_private_to_public(input: Token, to: address, amount: u128) -> (Token, Metadata, Final) {
        assert(input.owner == self.signer);
        return (
            Token { owner: input.owner, amount: input.amount - amount },
            Metadata { owner: input.owner },
            final { let b: u128 = Mapping::get_or_use(balances, to, 0u128); balances.set(to, b + amount); }
        );
    }

    fn transfer_public_to_private(recipient: address, public amount: u128) -> (Token, Final) {
        let c: address = self.caller;
        return (Token { owner: recipient, amount }, final { let b: u128 = balances.get(c); balances.set(c, b - amount); });
    }

    fn shield(public amount: u128) -> (Token, Final) {
        let s: address = self.signer;
        return (Token { owner: s, amount }, final { let b: u128 = balances.get(s); balances.set(s, b - amount); });
    }

    fn unshield(input: Token, amount: u128) -> (Token, Token, Final) {
        assert(input.owner == self.signer);
        let o: address = input.owner;
        return (
            Token { owner: o, amount: input.amount - amount },
            Token { owner: o, amount: 0u128 },
            final { let b: u128 = Mapping::get_or_use(balances, o, 0u128); balances.set(o, b + amount); }
        );
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
