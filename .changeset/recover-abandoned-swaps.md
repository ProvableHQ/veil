---
'@provablehq/shield-swap-sdk': minor
---

Recover abandoned swaps from chain, including their handles.

`used_blinded_addresses` is written by `finalize_swap`, not by the claim — so an
identity the chain reports used with no claim naming it is a swap that landed and
was never collected, with its output still sitting in `swap_outputs`. Previously
those were reported as unreachable, on the grounds that a claim needs the whole
handle and only the process that made the swap held one.

That was wrong. A swap request publishes almost everything a claim consumes:
`pool`, `zero_for_one`, `amount_in`, `amount_out_min`, `sqrt_price_limit`,
`nonce`, `deadline`, and both token ids are public inputs, and the swap id is a
public output. Multi-hop publishes its `SwapHop` structs the same way. The one
private piece is the blinding factor, and that is derived locally from the view
key and counter — which the store already holds.

So `reconcileSwapHistory` now reads swap requests as well as claims in the same
walk, and rebuilds a claimable handle from each. It also records `soldAmountIn`,
the figure no claim reports: a claim says what came back, only the request says
what it cost.

Verified by rebuilding a store from an empty file against 21 pages of testnet
history: 36 identities recovered, 32 settled, and four abandoned swaps rebuilt and
then claimed — 0.143939 USDCx and 4.068448 ALEO that had been sitting unclaimed,
two of them multi-hop.
