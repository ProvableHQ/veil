---
'@provablehq/shield-swap-sdk': minor
---

Remove `SHIELD_WRAPPERS`, and with it a table that never had a caller.

`SHIELD_WRAPPERS` named the three shield wrapper programs and the assets they
wrap. It shipped in 0.6.0 with testnet's underlyings hardcoded — `USDCx` mapped to
`test_usdcx_stablecoin.aleo` on every network, which is not the program that exists
on mainnet. The apparent fix was to split it per network, and the docblock claimed
the table was there because record selection needed an underlying program id before
any network round-trip.

That claim was false. Nothing in the SDK read the table, at any commit since it was
introduced. Wrapped-ness and the underlying program come from the AMM's own
`from_wrapper_token_id` mapping via `resolveTokenRoute`, which is what `swap` and
`swapMultiHop` spend from; private balances come from the API registry's
`underlying_program`. Both are per network by construction and cannot name a
testnet program while pointing at mainnet. The table answered a question that was
already answered, and answered it from a hand-maintained copy that could drift.

Callers wanting the underlying for a token id should read it the way the actions
do:

```ts
const route = await client.resolveTokenRoute({ tokenId })
if (route.wrapped) console.log(route.wrapperProgram, '→', route.underlyingProgram)
```

Removing rather than deprecating a published export is a break, and it is one on
purpose: a deprecation cycle would carry a symbol with no callers, whose only
tests asserted its literals against themselves, through another release. Mainnet
makes the drift concrete — mainnet runs two credits wrappers with confusable names,
`shield_swap_arc20_credits.aleo` (the one the AMM registers and every live pool
trades) and `arc20_wrapped_credits.aleo` (a bridge-family ARC-20 the AMM does not
know), and a curated list is exactly the artifact that gets that pair wrong.
