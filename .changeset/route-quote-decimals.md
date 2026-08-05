---
'@provablehq/shield-swap-sdk': minor
---

Fix the units of the route quote, add `planSwap`, `parseUnits`, and `formatUnits`.

`ApiClient.getRoute` typed `amount_in` as `bigint` and stringified it, implying the
raw base units every other amount in this SDK uses. The endpoint wants a decimal
string in the input token's units, and returns `estimated_amount_out` the same
way. Measured against testnet: `amount_in=0.5` quotes `0.000268655644950769` ETH,
while `amount_in=500000` — the base-unit form of the same half-token — quotes
`1.030419082712717843`, which is the pool's whole depth.

That is expensive rather than merely wrong. A caller who follows the type builds a
slippage floor three orders of magnitude above any achievable fill, and the swap
reverts on finalize with the fee consumed. It cost exactly that to find.

`amount_in` is now `string`, documented as the one place the API departs from base
units. The agent tool had the same defect twice over: its handler called `BigInt()`
on the value, which throws on `'0.5'`, and its schema told agents to pass "raw base
units (u128)" — the instruction that produces the revert. Both corrected.

`parseUnits` and `formatUnits` convert either way, named after viem's helpers and
parsing on the string because a double cannot hold 18 significant decimals.

`planSwap` turns "sell this for that" into an executable plan: the route from the
API, every hop's tradeability and liquidity checked on chain because the index can
list a pool the contract refuses to trade, the quote in base units, a slippage
floor, and the `imports` every hop needs — the thing callers most often get wrong
on multi-hop. A missing quote yields a zero floor and says so, rather than
inventing a guarantee.

Verified live: 0.5 USDCx → 0.000268655644950769 ETH, claimed in the same run, the
received amount matching the quote exactly.
