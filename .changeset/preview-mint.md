---
'@provablehq/shield-swap-sdk': minor
---

Add `previewMint`, which answers what a mint would open before anything is signed.

Everything needed to plan a deposit was already exported, but assembling it was
left to the caller: read the slot, floor both bounds onto the pool's tick spacing,
price them with `getSqrtPriceAtTickX128`, ask `liquidityForAmounts` what the
budget backs, then run it back through `amountsForLiquidity` with deposit-side
rounding to learn what the mint actually consumes. Six steps in a fixed order,
where getting the rounding direction wrong on the last one costs a reverted
transaction, and skipping the alignment on the second produces bounds the contract
rejects outright.

`previewMint(client, params)` composes exactly those primitives — it introduces no
new math — and returns the aligned bounds, the resulting liquidity, the amounts
each side gives up, and the pool state they were derived from. The range comes
either from explicit ticks or from `rangePercent`, a half-width in percent of the
pool's current price that defaults to 5, so a caller who thinks in "±5% around the
market" does not have to convert to ticks. Bounds are reported after alignment,
because that is the range the mint opens.

Two things it reports that a caller would otherwise have to know to look for:
`inRange`, since a position outside the active tick earns nothing and is funded
from one side only, and `feeTierSpacing`, the spacing the `fee_to_tick_spacing`
registry binds to the pool's fee — equal to the pool's own on a healthy pool, and
a signal that the pool has drifted from its fee tier when it is not. The pool's
spacing governs either way, because that is what `mint` aligns against.

`liquidity` of 0 is a result, not an error: the budget backs nothing over that
range, so a mint would cost a fee and open nothing.
