# Swapping: discover pools and swap privately

Goal: find live pools, quote a route, and execute private swaps — one at a
time or several concurrently. Prerequisite: [startup.md](./startup.md)
passed (exit 0, private holdings visible).

A private swap is two transactions: `swap()` submits the request and
returns a `SwapHandle`; `claimSwapOutput()` later withdraws the output to a
private record. Claims are covered in [collecting.md](./collecting.md) —
this runbook ends with persisted handles.

## Discovery

Everything a swap needs comes from three reads:

```ts
import { loadSession } from '@provablehq/shield-swap-cli/session'

const { client, account } = await loadSession()

// What the account can sell (private side funds swaps).
const balances = await client.getBalances()
const funded = Object.entries(balances).filter(([, b]) => b.private > 0n)

// Pools whose input token the account holds, with live liquidity.
const pools = (await client.api.getPools({ limit: 50 })).data
const candidates = []
for (const pool of pools) {
  const holdIn = funded.find(([id]) => id === pool.token0 || id === pool.token1)
  if (!holdIn || !pool.token0_info?.amm_token_program || !pool.token1_info?.amm_token_program) continue
  const slot = await client.getSlot({ poolKey: pool.key })
  if (slot && slot.liquidity > 0n) candidates.push({ pool, holdIn, slot })
}
```

Sizing: sell a small fraction of the holding (1–10%) so repeated swaps
don't drain a record, and stay well under the pool's liquidity. Two hard
rules on `amountIn`:

- **Raw atomic units.** The AMM accounts in raw token base units — pass
  `amountIn` as the integer base-unit amount (no decimal scaling, no dust
  flooring; that rule is gone in the new stack).
- **One covering record.** Record selection picks ONE private record big
  enough for `amountIn`; it does not aggregate. After many swaps the change
  fragments — if a swap reports no covering record, lower `amountIn`.

## One private swap

The token in/out are named by their AMM token ids; the SDK resolves whether
they're wrapped and routes through the correct program internally — you never
name a wrapper.

```ts
import { ApiError } from '@provablehq/shield-swap-sdk'
import { formatAmount } from '@provablehq/shield-swap-cli/session'

const { pool, holdIn } = candidates[0]
const [tokenInId, balance] = holdIn
const tokenOutInfo = tokenInId === pool.token0 ? pool.token1_info : pool.token0_info
const amountIn = balance.private / 100n // 1% of the covering record

// Quote → slippage floor. The quote is informational: a missing estimate
// or a 404 ("no executable route … for the requested amount") is fine —
// without expectedOut the swap falls back to a spot-price floor derived
// from slippageBps. UNITS TRAP: the API sometimes formats the estimate as
// a decimal string ("0.5097…") instead of raw base units; only an
// integral string is safe to use as expectedOut — anything else would set
// a wildly wrong slippage floor.
let expectedOut: bigint | undefined
try {
  const route = await client.api.getRoute({
    token_in: tokenInId,
    token_out: tokenOutInfo!.address,
    amount_in: amountIn,
  })
  const est = route.data.estimated_amount_out
  expectedOut = est && /^\d+$/.test(est) ? BigInt(est) : undefined
} catch (err) {
  if (!(err instanceof ApiError && err.status === 404)) throw err
}

// Every write needs an imports map: both pool tokens' program sources PLUS
// the DEX program's own declared imports (the prover does not resolve
// those). resolveDexImports assembles all of it.
const imports = await client.resolveDexImports({ tokenPrograms: [
  pool.token0_info!.amm_token_program!,
  pool.token1_info!.amm_token_program!,
] })

const handle = await client.swap({
  poolKey: pool.key,
  tokenInId,
  amountIn,
  expectedOut,
  slippageBps: 100, // 1%
  imports,
})

// The handle is already persisted: the client reserved the blinded identity
// before submitting and recorded the whole handle after, into the store
// loadSession configured. Nothing to remember, and nothing to forget.
console.log('swap submitted:', handle.transactionId, 'swapId:', handle.swapId)
```

Expect a minute or two: remote proving plus on-chain confirmation.

**Claim immediately.** As soon as the swap transaction lands, collect the
output in the same session — do not leave it for a later sweep. The output
becomes claimable once the swap finalizes (a few blocks after
confirmation), so the first attempts may throw
`SwapOutputNotFinalizedError`; that is normal, retry:

```ts
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'

// Same imports map as the swap.
for (let attempt = 0; attempt < 10; attempt++) {
  try {
    const { amountOut, transactionId } = await client.claimSwapOutput({ handle, imports })
    console.log(`claimed ${formatAmount(amountOut, tokenOutInfo!.decimals, tokenOutInfo!.symbol)} (tx ${transactionId})`)
    // The claim marks the identity `claimed` in the store itself.
    break
  } catch (err) {
    if (!(err instanceof SwapOutputNotFinalizedError)) throw err
    await new Promise((r) => setTimeout(r, 15_000)) // finalize lag — wait and retry
  }
}
```

[collecting.md](./collecting.md) remains the recovery path: anything left
in the state file (a crash between swap and claim, a claim that gave up)
gets swept there.

## Several swaps at once

**Ask before executing.** Concurrency is bounded by what the account
holds: each concurrent swap needs a DIFFERENT input token (one covering
record per token — see below), so the possible concurrent swaps are one
per distinct held token that has a live pool. Before running anything:

1. Discover the candidates — for each token the account holds privately,
   find a pool with liquidity it can trade into (the discovery loop above,
   keeping one entry per input token).
2. Present them to the user in plain language ("you can place up to N
   trades at once: ETH → wUSDCx, wALEO → ETH, …").
3. Ask how many — and which — swaps they want, up to that maximum. Only
   then execute.

Two per-account resources collide under concurrency; both must be
partitioned explicitly:

1. **Blinded-identity counters.** Each swap consumes a single-use blinded
   address derived from a counter. `swap()` discovers the next unused
   counter by scanning the chain — concurrent swaps see the same chain and
   pick the SAME counter, and all but one gets rejected. Fix: reserve a
   counter block up front and pass each swap its own explicit identity.
2. **Input records.** Record selection picks the one covering record per
   token — concurrent swaps selling the SAME token grab the same record and
   all but one fails as a double-spend. Fix: give each concurrent swap a
   different input token. (Same-token bursts require record splitting;
   prefer different tokens or sequential submission instead.)

```ts
// swaps[] entries MUST each sell a different token (disjoint records).
// Identities need no handling here: each call reserves its own from the store,
// and reservations serialize, so two swaps cannot derive the same blinded
// address and have the second revert on the uniqueness assert.
const results = await Promise.allSettled(swaps.map((s) => client.swap(s)))
```

Without a configured store this is the one flow that breaks: both calls would
scan the chain, find the same free counter, and the second would revert on
finalize having paid its fee. `loadSession` configures one, so this is safe by
default — see the SDK README's "Concurrent swaps" section for the mechanism.

`Promise.all` rejects on the first failure but the other swaps keep
running server-side — always sweep with
`client.getUnclaimedSwaps()` afterwards and claim everything that confirmed,
regardless of batch errors. Use
`Promise.allSettled` to keep the batch alive past one rejection.

**Claim immediately after the batch.** As each swap confirms, its output
is claimable a few blocks later — claim all of them right away (the same
retry loop as the single-swap recipe, one handle at a time, reusing each
swap's own imports map) instead of deferring to a later session:

```ts
for (const [i, result] of results.entries()) {
  if (result.status !== 'fulfilled') continue
  const handle = result.value
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const { amountOut } = await client.claimSwapOutput({ handle, imports: swaps[i]!.imports })
      // Display in human units (swaps[i] should carry the out token's decimals/symbol).
      console.log(`claimed ${formatAmount(amountOut, swaps[i]!.outDecimals, swaps[i]!.outSymbol)}`)
      break
    } catch (err) {
      if (!(err instanceof SwapOutputNotFinalizedError)) throw err
      await new Promise((r) => setTimeout(r, 15_000))
    }
  }
}
```

## Multi-hop

When no direct pool connects two tokens, `client.api.getRoute` returns a
multi-hop path (≤ 3 hops) and `client.swapMultiHop` executes it — same
handle-and-claim discipline, with `poolKeys` (plural) and every hop token's
program source in `imports`. The same record and identity rules apply: one
multi-hop swap consumes one input record and one blinded identity, reserved and
recorded for you. The collecting sweep tells the two shapes apart (multi-hop
handles carry `poolKeys`) and claims each with the right action.

## Failure modes

| Symptom | Cause | Remedy |
| --- | --- | --- |
| `requires auth` / 401 | Session missing or expired | `loadSession()` authenticates; it auto-renews. Re-run the script. |
| 403 `redeem an invite code` | Access gate | Back to [startup.md](./startup.md) — redeem a code. |
| No covering record for `amountIn` | Fragmented/small records | Lower `amountIn`, or airdrop again if truly empty. |
| Duplicate blinded address rejection | Concurrent swaps raced the counter scan | Use the explicit-identity recipe above. |
| Double-spend rejection | Two swaps selected the same record | Different input tokens per concurrent swap. |
| `/route` 404 `no executable route … for the requested amount` | Quote unavailable at that size | Proceed without `expectedOut` (spot floor applies), or resize the trade. |
| `amount_out_min` revert | Price moved past slippage | Re-quote, widen `slippageBps` modestly, retry. |
| Swap confirmed but output missing | Not finalized yet | Normal — claim with the retry loop in [collecting.md](./collecting.md). |
