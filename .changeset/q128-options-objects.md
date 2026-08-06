---
'@provablehq/shield-swap-sdk': minor
---

Give the Q128 position math options objects, and add `liquidityForAmount`.

The math helpers took their arguments positionally, and the arguments are mostly
same-typed bigints: `amountsForLiquidity(sqrtPrice, sqrtA, sqrtB, liquidity,
roundUp)`. Swapping the price for a bound type-checks and returns a plausible
wrong answer — a position reported as one-sided when it straddles the price, or a
deposit sized against the wrong end of its range. Nothing catches it.

They now take objects with named fields, matching `feeGrowthInside`, which was
already shaped that way, and the viem convention these packages otherwise follow:
positional for one or two obvious arguments, an options object as soon as the
arguments are confusable.

```ts
const range = {
  sqrtPriceX128: slot.sqrt_price,
  sqrtLowerX128: getSqrtPriceAtTickX128(tickLower),
  sqrtUpperX128: getSqrtPriceAtTickX128(tickUpper),
}
const liquidity = liquidityForAmounts({ ...range, amount0, amount1 })
const amounts = amountsForLiquidity({ ...range, liquidity, roundUp: true })
```

Nothing breaks yet. `amountsForLiquidity`, `amount0DeltaX128`, `amount1DeltaX128`
and `feeOwed` shipped in 0.6.0, so each keeps its positional form as a deprecated
overload returning identical numbers, removed in the next major; a test asserts
the two shapes agree, including the wrapping path in `feeOwed` where transposing
the growth figures is the specific mistake the object form prevents.
`liquidityForAmounts` was never released and takes the object form only.

Also adds `liquidityForAmount`, which answers what ONE side alone supports.
`liquidityForAmounts` takes two ceilings and lets the shorter one govern, which is
right for "deposit what I have" and wrong for "deposit exactly this much of one
token" — there, a short balance on the other side silently shrinks the position
instead of reporting that it cannot be funded. Pair it with `amountsForLiquidity`
to get the other side's minimum. It returns `0` when the price puts the named side
out of use — above a range a position holds only token1, so token0 funds nothing —
which is a different condition from "deposit more" and worth distinguishing.

`liquidity.ts --increase` uses it: naming one amount now derives the other as the
minimum that must accompany it, and fails with what is needed and what is held
when the balance cannot cover it, rather than depositing a fraction of what was
asked for.
