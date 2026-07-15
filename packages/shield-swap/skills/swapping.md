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
import { loadSession, getHoldings } from '$SKILLS/scripts/session.js'

const { client, account } = await loadSession()

// What the account can sell (private side funds swaps).
const holdings = await getHoldings(client, account.address)
const funded = holdings.filter((h) => h.privateAmount > 0n && h.wrapperProgram)

// Pools whose input token the account holds, with live liquidity.
const pools = (await client.api.getPools({ limit: 50 })).data
const candidates = []
for (const pool of pools) {
  const holdIn = funded.find((h) => h.tokenId === pool.token0 || h.tokenId === pool.token1)
  if (!holdIn || !pool.token0_info?.wrapper_program || !pool.token1_info?.wrapper_program) continue
  const slot = await client.getSlot({ poolKey: pool.key })
  if (slot && slot.liquidity > 0n) candidates.push({ pool, holdIn, slot })
}
```

Sizing: sell a small fraction of the holding (1–10%) so repeated swaps
don't drain a record, and stay well under the pool's liquidity. Two hard
rules on `amountIn`:

- **No-dust rule.** The contract rejects amounts whose low `decimals - 9`
  digits are non-zero (tokens with more than 9 decimals). ALWAYS floor
  through the session helper: `floorToDust(amount, token.decimals)`.
- **One covering record.** Record selection picks ONE private record big
  enough for `amountIn`; it does not aggregate. After many swaps the change
  fragments — if a swap reports no covering record, lower `amountIn`.

## One private swap

```ts
import { getProgram } from '@provablehq/veil-core'
import { ApiError } from '@provablehq/shield-swap-sdk'
import { appendSwapHandle, floorToDust } from '$SKILLS/scripts/session.js'

const { pool, holdIn } = candidates[0]
const tokenInId = holdIn.tokenId
const tokenOutInfo = tokenInId === pool.token0 ? pool.token1_info : pool.token0_info
const tokenInProgram = holdIn.wrapperProgram!
const amountIn = floorToDust(holdIn.privateAmount / 100n, holdIn.decimals) // 1%, dust-safe

// Quote → slippage floor. The quote is informational: a missing estimate
// or a 404 ("no executable route … for the requested amount") is fine —
// without expectedOut the swap falls back to a spot-price floor derived
// from slippageBps.
let expectedOut: bigint | undefined
try {
  const route = await client.api.getRoute({
    token_in: tokenInId,
    token_out: tokenOutInfo!.address,
    amount_in: amountIn,
  })
  const est = route.data.estimated_amount_out
  expectedOut = est ? BigInt(est) : undefined
} catch (err) {
  if (!(err instanceof ApiError && err.status === 404)) throw err
}

// The prover cannot discover token-program callees statically — pass both
// pool tokens' program sources as imports on every write.
const p0 = pool.token0_info!.wrapper_program!
const p1 = pool.token1_info!.wrapper_program!
const imports = {
  [p0]: await getProgram(client, { programId: p0 }),
  [p1]: await getProgram(client, { programId: p1 }),
}

const handle = await client.swap({
  poolKey: pool.key,
  tokenInId,
  amountIn,
  tokenInProgram,
  expectedOut,
  slippageBps: 100, // 1%
  imports,
})

// PERSIST THE HANDLE IMMEDIATELY — it is the only key to the output.
// appendSwapHandle re-reads the state file, so it never clobbers handles
// another script saved meanwhile.
appendSwapHandle(handle)
console.log('swap submitted:', handle.transactionId, 'swapId:', handle.swapId)
```

Expect a minute or two: remote proving plus on-chain confirmation. Then
claim per [collecting.md](./collecting.md) (the output is claimable only
after the swap finalizes — the claim runbook handles the retry).

## Several swaps at once

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
import { viewKeyToScalar, nextBlindedIdentity } from '@provablehq/shield-swap-sdk'
import { appendSwapHandle } from '$SKILLS/scripts/session.js'

// Reserve K distinct UNUSED identities. Scan forward for each one — used
// counters are not always contiguous (failed swaps leave gaps), so
// `first.counter + i` is NOT safe.
const vk = await viewKeyToScalar(account.viewKey)
const identities = []
let startCounter = 0
for (let i = 0; i < swaps.length; i++) {
  const id = await nextBlindedIdentity(client, {
    viewKeyScalar: vk,
    signer: account.address,
    startCounter,
  })
  identities.push({ blindingFactor: id.blindingFactor, blindedAddress: id.blindedAddress })
  startCounter = id.counter + 1 // next scan starts past this reservation
}

// swaps[] entries MUST each sell a different token (disjoint records).
const handles = await Promise.all(
  swaps.map((s, i) =>
    client.swap({ ...s, blindedIdentity: identities[i] }).then((h) => {
      // Persist as each one lands, not after the batch — a crash mid-batch
      // must not orphan the finished swaps.
      appendSwapHandle(h)
      return h
    }),
  ),
)
```

`Promise.all` rejects on the first failure but the other swaps keep
running server-side — always sweep `state.swapHandles` afterwards and claim
everything that confirmed, regardless of batch errors.

## Multi-hop

When no direct pool connects two tokens, `client.api.getRoute` returns a
multi-hop path (≤ 3 hops) and `client.swapMultiHop` executes it — same
handle-and-claim discipline, with `poolKeys` (plural) and every hop token's
program source in `imports`. The same record and identity rules apply: one
multi-hop swap consumes one input record and one blinded identity. Persist
the handle with `appendSwapHandle` like any other — the collecting sweep
tells the two shapes apart (multi-hop handles carry `poolKeys`) and claims
each with the right action.

## Failure modes

| Symptom | Cause | Remedy |
| --- | --- | --- |
| `requires auth` / 401 | Session missing or expired | `loadSession()` authenticates; it auto-renews. Re-run the script. |
| 403 `redeem an invite code` | Access gate | Back to [startup.md](./startup.md) — redeem a code. |
| No covering record for `amountIn` | Fragmented/small records | Lower `amountIn`, or airdrop again if truly empty. |
| `rejects amounts with non-zero dust digits` | `amountIn` violates the no-dust rule | Floor it: `floorToDust(amount, decimals)`. |
| Duplicate blinded address rejection | Concurrent swaps raced the counter scan | Use the explicit-identity recipe above. |
| Double-spend rejection | Two swaps selected the same record | Different input tokens per concurrent swap. |
| `/route` 404 `no executable route … for the requested amount` | Quote unavailable at that size | Proceed without `expectedOut` (spot floor applies), or resize the trade. |
| `amount_out_min` revert | Price moved past slippage | Re-quote, widen `slippageBps` modestly, retry. |
| Swap confirmed but output missing | Not finalized yet | Normal — claim with the retry loop in [collecting.md](./collecting.md). |
