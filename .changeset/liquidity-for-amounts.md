---
'@provablehq/shield-swap-sdk': minor
---

Add `liquidityForAmounts`, the deposit-side inverse of `amountsForLiquidity`.

The package could turn a liquidity figure into token amounts but not the reverse,
which is the direction a depositor starts from: a caller holds two balances and
wants to know what position they support. Without it, every caller had to invent a
liquidity number and work forwards, and a figure that balances at one pool's price
falls short at another — one side runs out and the mint reverts.

`liquidityForAmounts` mirrors the contract's own derivation: at or below the range
token0 binds, at or above it token1, and inside the range the shorter side governs,
with the same branch boundaries as `amountsForLiquidity` (`price <= lower` counts as
below). Every step floors, so the result is a lower bound — feeding it back through
`amountsForLiquidity` with deposit-side rounding returns amounts that fit inside the
originals, which is what keeps a mint from reverting for want of a base unit. That
property is asserted across a sweep of ticks, range widths, and magnitudes rather
than on a single case. It returns 0 when the amounts are dust for the range's width.
