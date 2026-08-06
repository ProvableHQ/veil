# QS MM Guide — revised code sections (shield-swap-sdk 0.6.0)

Replaces the client wiring in **Setup (JS/TS)** and everything from the **Swaps**
heading to the end. Verified against the Veil repo working tree.

## URI corrections above the Swaps heading

The REST API table names the wrong DEX host. The API is per-network on separate
domains:

| API | Endpoint |
| --- | --- |
| Provable API (Aleo reads/writes) | `https://api.provable.com/v2` |
| Shield Swap API — mainnet | `https://api.swap.shield.fi` |
| Shield Swap API — testnet | `https://api.testnet.swap.shield.fi` |

`amm-api.dev.provable.com` is deprecated: it indexes the pre-migration
`shield_swap_v3.aleo` and serves pools that do not exist on `shield_swap.aleo`.
Do not name any of these hosts in code — `shieldSwapActions` derives the DEX host
from the client's network, so a client that switches chains keeps talking to the
matching deployment.

---

## Setup (JS/TS) — client wiring

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { fileCredentialStore } from '@provablehq/veil-aleo-sdk/node'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { fileBlindedIdentityStore } from '@provablehq/shield-swap-sdk/node'

const network = 'testnet' // mainnet is never implicit
const aleo = await loadNetwork(network)

// One credential set reaches both the prover and the scanner; no prover or
// scanner URL, because both default to the Provable API and take the network
// from the client.
const scanner = aleo.createRemoteScanner()
const { walletClient, account } = aleo.createAleoClient({
  privateKey: process.env['ALEO_PRIVATE_KEY']!,
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated',
  credentialStore: fileCredentialStore(`./.shield-swap/${network}/provable-credentials.json`),
  useFeeMaster: true, // the prover pays fees; a faucet-funded account holds no credits
  records: scanner,
})

// No `baseUrl`: the DEX host is derived per network. The identity store is what
// makes concurrent swaps safe and unclaimed swaps recoverable — scope it per
// network, since a reservation is only meaningful against one chain.
const client = walletClient.extend(
  shieldSwapActions({
    api: {},
    blindedIdentities: fileBlindedIdentityStore(`./.shield-swap/${network}/blinded.json`),
  }),
)

await client.authenticateProvableApi() // registers a consumer on first run
await client.authenticateShieldSwap() // challenge/verify handshake, renews on 401

if (!(await client.api.getAccessStatus()).has_access) {
  await client.api.redeemAccessCode(process.env['SHIELD_SWAP_INVITE_CODE']!)
}

// Optional: a long-lived token skips the handshake next session. The secret is
// shown once — store it, then pass it as `api: { apiToken }`.
const created = await client.api.createApiToken({ name: 'trading-bot' })
```

## The runnable reference

Every flow below is a subcommand of `shield-swap`, which ships in
`@provablehq/shield-swap-cli` — a separate install from this package, so a
project that only needs the client never pulls it in: `setup`, `pools`,
`balances`, `positions`, `swap`, `swap-concurrent`, `history`, `mint`,
`liquidity`, `collect`, and `liquidity-e2e`.

Nothing spends without `--execute`: every write command plans against live chain
state, prints the plan, and stops. Start there rather than from these excerpts.

```sh
npx @provablehq/shield-swap-cli swap --from USDCx --to ETH --amount 1.5   # dry run
npx @provablehq/shield-swap-cli swap --from USDCx --to ETH --amount 1.5 --execute
```

Worked examples of the same flows against the SDK directly live in
[`examples/shield-swap/`](https://github.com/ProvableHQ/veil/tree/main/examples/shield-swap).

## Swaps

A private swap settles in two transactions. `swap` submits the request, the chain
computes the output, and `claimSwapOutput` withdraws it into a private record. The
`SwapHandle` the first returns is the only key to the second.

### The swap lifecycle

```
plan the trade (route, quote, floor, imports)
  → reserve a blinded identity
  → submit the swap
  → persist the handle
  → wait for finalize
  → claim the private output
```

Reservation and persistence are the store's job. Nothing in an application should
derive an identity, hold a handle in memory, or track a swap by hand.

### 1. Plan the trade

`planSwap` resolves both tokens, quotes the route, converts the quote into base
units, checks every hop on chain, and assembles the `imports` a write needs.
Pool selection, unit conversion, and multi-hop detection are all its output.

```ts
import { parseUnits, formatUnits } from '@provablehq/shield-swap-sdk'

const from = await client.tokenData('USDCx') // symbol or id
const amountIn = parseUnits('1.5', from.decimals)

// A swap spends ONE record, not the sum of several — check the private side
// before planning.
const balances = await client.getBalances({ tokens: [from.id] })
if ((balances[from.id]?.private ?? 0n) < amountIn) throw new Error('no covering record')

const plan = await client.planSwap({ from: from.id, to: 'ETH', amountIn, slippageBps: 50 })

console.log(
  `sell ${formatUnits(plan.amountIn, plan.from.decimals)} ${plan.from.symbol}`,
  `buy ~${formatUnits(plan.expectedOut, plan.to.decimals)} ${plan.to.symbol}`,
  `floor ${formatUnits(plan.minOut, plan.to.decimals)}`,
  `route ${plan.poolKeys.join(' → ')}`,
)
```

The plan carries `poolKeys`, `multiHop`, `expectedOut`, `minOut`, and `imports`. It
throws when a token is unknown on the network, when no pool connects the pair, and
when any hop is paused, gated, or empty — those checks read the chain, because the
index can list a pool the contract refuses to trade.

`parseUnits` and `formatUnits` are the only conversion an application performs:
`/route` speaks decimal strings, the AMM accounts in raw base units, and
`Number(amount) * 10 ** decimals` loses precision and sets an invalid floor. An
absent quote leaves `expectedOut` and `minOut` at `0n`, which means the swap
carries no floor rather than a floor of zero.

### 2. Submit and claim

```ts
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'

const handle = plan.multiHop
  ? await client.swapMultiHop({
      poolKeys: plan.poolKeys,
      tokenInId: plan.from.id,
      amountIn: plan.amountIn,
      expectedOut: plan.expectedOut,
      slippageBps: plan.slippageBps,
      imports: plan.imports,
    })
  : await client.swap({
      poolKey: plan.poolKeys[0]!,
      tokenInId: plan.from.id,
      amountIn: plan.amountIn,
      expectedOut: plan.expectedOut,
      slippageBps: plan.slippageBps,
      imports: plan.imports,
    })

// The handle is already stored: the identity was reserved before submission and
// the handle recorded after it. The output becomes claimable a few blocks after
// the swap finalizes, so early failures are the normal path.
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle, imports: plan.imports })
    break
  } catch (error) {
    if (!(error instanceof SwapOutputNotFinalizedError)) throw error
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  }
}
```

Wrapped tokens resolve on chain. The caller names AMM token ids and never a
wrapper program: a wrapped input spends the account's underlying records, and the
claim pays out the underlying asset. A local account selects its own input record;
a wallet account MUST supply `tokenRecord` as a record InputRequest, because the
client cannot guess a wallet's record shape.

`SwapOutputNotFinalizedError` means the request has not finalized yet — or that the
output was already claimed, since a claim consumes the mapping entry. Past roughly
five minutes, treat it as the second case and check the request transaction on
chain.

### 3. Concurrency and recovery

Two per-account resources collide under concurrency, and the SDK partitions one of
them.

- **Blinded identities.** Each swap spends a single-use address derived from a
  counter, and the chain rejects a repeat. The configured store hands out counters
  under serialization, so concurrent swaps cannot derive the same address. Without
  a store, identities come from scanning the chain, which is safe in sequence only.
- **Input records.** Record selection picks one covering record per token, so two
  concurrent swaps selling the same token pick the same record and all but one
  fails as a double spend. Give each concurrent swap a different input token, or
  split records first.

```ts
// One swap per token sold, planned before any is submitted.
const handles = await Promise.allSettled(plans.map((plan) => client.swap({ ...toArgs(plan) })))
```

The store is also the recovery ledger:

```ts
const { swaps, totals, unresolvable } = await client.getUnclaimedSwaps()
for (const swap of swaps) {
  if (!swap.claimable) continue // owed on chain, but no stored handle to claim with
  const [tokenIn, tokenOut] = await Promise.all([
    client.tokenData(swap.output.token_in),
    client.tokenData(swap.output.token_out),
  ])
  const imports = await client.resolveDexImports({
    tokenPrograms: [tokenIn.ammTokenProgram!, tokenOut.ammTokenProgram!],
  })
  await client.claimSwapOutput({ handle: swap.handle!, imports })
}
if (unresolvable.length) await client.reconcileSwapHistory()
```

`getUnclaimedSwaps` reads `swap_outputs` rather than trusting stored statuses, so
an entry appears exactly when a claim would succeed, and each one carries the
handle rebuilt from the store — which is what lets a different process claim a swap
it did not submit. `reconcileSwapHistory` walks `claim_swap_output` history to
recover swap ids the store never recorded. Neither reconstructs a handle from chain
alone, so a durable store is the only complete answer. `swap-history.ts` also
rebuilds an empty store from chain, re-deriving identities from the view key.

### Multi-hop

`swapMultiHop` executes a two- or three-pool route from the same plan, taking
`poolKeys` (plural); `claimSwapOutput` claims both handle shapes. Intermediate
tokens stay inside the atomic route, and the final claim can also return an
unfilled input refund.

### Addressing a pool directly

A swap needs no pool key — `planSwap` returns the route. Everything else (a
liquidity operation, a price feed, a depth check) takes one, and a pool key is
derivable locally from the pair and the fee tier. No listing scan, no filtering
over `getPools` metadata:

```ts
import { derivePoolKey, poolPrice } from '@provablehq/shield-swap-sdk'

const [usdc, eth] = await Promise.all([client.tokenData('USDCx'), client.tokenData('ETH')])
// Token order does not matter; fee is in PIPS (3000 = 0.30%), not basis points.
const poolKey = await derivePoolKey({ token0: usdc.id, token1: eth.id, fee: 3000 })

const slot = await client.getSlot({ poolKey }) // null means no pool at that tier
if (slot) console.log(poolPrice({ slot, decimals0: usdc.decimals, decimals1: eth.decimals }).price1Per0)
```

`derivePoolKey` computes the contract's own `BHP256` hash locally — pure, no
network. Use `client.api.getPools()` for what a derivation cannot answer: which
fee tiers exist for a pair, and how deep each one is. `pools.ts` prints exactly
that, joining every listing with its chain slot.

### What the application owns

- input-record partitioning across concurrent writes, and record splitting when no
  single record covers the trade
- a durable blinded-identity store, without which claims are unrecoverable
- proof and confirmation latency: budget minutes, not milliseconds
- retrying only when the previous transaction's terminal state is known
- slippage, notional, inventory, oracle-age, and loss controls

## Provide liquidity

A position is a private PositionNFT record; its liquidity, tick range, and owed
amounts are public under a stable `positionTokenId`. `getOwnedPositions`
rediscovers every position — id, pool, range, backing amounts, uncollected fees —
from the account's records, so there is no local list to keep in sync.

### Liquidity workflows

| Workflow | Actions | Result |
| --- | --- | --- |
| Open a position | `previewMint` → `mint` | A private PositionNFT and a stable position token id |
| Increase liquidity | `increaseLiquidity` | More liquidity, range unchanged |
| Decrease liquidity | `decreaseLiquidity` | Principal booked as owed to the position, not paid out |
| Collect | `collect` | Owed principal and fees paid to the withdrawal address as private records |
| Close | decrease to zero → collect → `burn` | Position closed |
| Create and seed a pool | `createPool` → `mint` | A new concentrated-liquidity market |

### Choose a liquidity integration

| Approach | Suited to | What the integrator handles | Complexity |
| --- | --- | --- | --- |
| SDK + connected wallet | User-facing LP interfaces | Pool/range UI, record InputRequests, transaction lifecycle | Medium |
| SDK + local key | Automated LP managers, market operators | Keys, scanning, proving, range policy, collection | Medium |
| Native Aleo program calls | Custom vault or protocol integrations | Record serialization, insert hints, every transition input | High |

The data API discovers pools and indexes positions. It never returns a formed
liquidity transaction.

### 1. Preview, then mint

A deposit is not the pair of amounts offered — it is what the range consumes out of
them, and the two differ at every price except the one the amounts happen to
balance at. `previewMint` reports the difference before anything is signed: the
bounds after alignment to the pool's tick spacing, the liquidity the budget backs
there, and how much of each side the mint actually takes.

```ts
// poolKey from derivePoolKey (above). The pool's own token0/token1 order is what
// every amount below is denominated in, and it need not match the pair as named.
const [pool, controls] = await Promise.all([
  client.getPool({ poolKey }),
  client.getTradeControls({ poolKey }),
])
if (!pool) throw new Error('no pool at that pair and fee tier')
if (!controls.tradeable) throw new Error('pool is gated on chain — a mint would revert')

const [token0, token1] = await Promise.all([client.tokenData(pool.token0), client.tokenData(pool.token1)])
const held = await client.getBalances({ tokens: [token0.id, token1.id] })

// The budget is a ceiling; the preview reports what the range consumes out of it.
const preview = await client.previewMint({
  poolKey,
  amount0Desired: held[token0.id]!.private / 20n,
  amount1Desired: held[token1.id]!.private / 20n,
  rangePercent: 5, // half-width in percent of the current price
})
if (preview.liquidity === 0n) throw new Error('that budget backs nothing over this range')
if (!preview.inRange) console.log('price is outside the range — it earns nothing yet')
```

```ts
const imports = await client.resolveDexImports({
  tokenPrograms: [token0.ammTokenProgram!, token1.ammTokenProgram!],
})

const { positionTokenId } = await client.mint({
  poolKey,
  tickLower: preview.tickLower,
  tickUpper: preview.tickUpper,
  amount0Desired: preview.amount0, // what the range consumes, not the budget
  amount1Desired: preview.amount1,
  recipient: account.address,
  withdrawal: account.address,
  imports,
})
```

Four things the SDK owns here, and an integration should not:

- **Tick alignment and range placement** — `previewMint` returns aligned bounds,
  and `mint` aligns again. `rangePercent` replaces hand-rolled tick arithmetic.
- **Insert hints.** Do not pass `tickLowerHint`/`tickUpperHint`. `mint` derives
  both and applies a correction a caller cannot: finalize inserts the lower tick
  before validating the upper hint, so with no initialized tick between the bounds
  the upper predecessor is the just-inserted lower tick rather than the one visible
  on chain. An explicit hint disables the correction and reverts on that case.
- **Record selection and wrapped-ness.** The AMM token programs feed `imports`
  only; the programs holding the caller's records are resolved on chain, and a
  wrapped side spends the underlying asset's record.
- **Fee tier and spacing checks.** `previewMint` returns `feeTierSpacing`
  alongside the pool's `tickSpacing`. They agree on a healthy pool; when they
  differ, the pool has drifted from the tier it was created under and the pool's
  spacing governs. Nothing needs to read `fee_to_tick_spacing` by hand, and
  nothing should convert the API's basis-point `pool.fee` into the chain's pips.

`recipient` and `withdrawal` are required and have no defaults: `withdrawal` is
where every later `collect` pays, fixed for the position's life, so a cold payout
address stays a deliberate decision. `amount0Min`/`amount1Min` are usually
unnecessary — the contract takes at most the desired amounts, so a price that moves
between preview and finalize deposits slightly less rather than more, and a
minimum would turn that into a revert.

Mapping writes propagate to reads asynchronously, so poll `getPosition` for a few
seconds before treating a fresh mint as missing.

### 2. Add or remove liquidity

```ts
const position = await client.getOwnedPosition({ positionTokenId })
if (position!.frozen) throw new Error('position is frozen — every liquidity operation reverts')

await client.increaseLiquidity({
  poolKey: position!.poolKey,
  positionTokenId,
  amount0Desired: extra0,
  amount1Desired: extra1,
  imports,
})

await client.decreaseLiquidity({
  poolKey: position!.poolKey,
  positionTokenId,
  liquidityToRemove: position!.state!.liquidity / 2n,
})
```

`increaseLiquidity` keeps the range fixed at mint. `decreaseLiquidity` moves no
tokens — withdrawn principal is booked as owed to the position — and needs no
`imports`, because no transfer happens. Always pass `positionTokenId`: pool-only
record selection turns ambiguous the moment a second position exists in the same
pool. To size a withdrawal by token amount rather than by liquidity, the exported
`liquidityForAmounts`, `amountsForLiquidity`, and `getSqrtPriceAtTickX128` mirror
the contract's own math — do not reimplement it.

### 3. Collect principal and fees

Two figures matter and they are not the same one. `tokens_owed0/1` in the positions
mapping is what the contract has already booked. Fees earned since then are not
booked yet, but the finalize settles them before checking the request, so they are
collectable today — and `getOwnedPositions` mirrors that settlement as
`uncollectedFees0/1`. Request the mirrored total.

```ts
for (const position of await client.getOwnedPositions()) {
  if (!position.state) continue // a fresh mint that has not finalized yet
  const { uncollectedFees0, uncollectedFees1 } = position.state
  if (uncollectedFees0 === 0n && uncollectedFees1 === 0n) continue

  await client.collect({
    poolKey: position.poolKey,
    positionTokenId: position.positionTokenId,
    amount0Requested: uncollectedFees0,
    amount1Requested: uncollectedFees1,
    imports,
  })
}
```

Amounts are raw base units and the chain caps each at what is owed — the
dust-flooring rule of the earlier stack is gone. Payment goes to the withdrawal
address fixed at mint, not to whoever submits the collect. New records index
asynchronously, so a confirmed collect can precede their appearance in a scanner
query.

### 4. Close the position

```ts
await client.decreaseLiquidity({ poolKey, positionTokenId, liquidityToRemove: position.state!.liquidity })
// collect everything owed, then:
await client.burn({ poolKey, positionTokenId })
```

`burn` rejects a position holding liquidity or owed balances. On a local-key path,
allow the scanner to index the re-issued PositionNFT between sequential writes to
the same position. `collect.ts --close` and `liquidity-e2e.ts` run this sequence
with the waits each step needs.

### What the application owns

- private records on both sides, and a scanner that has indexed the PositionNFT
  between writes
- range selection, rebalancing policy, and out-of-range monitoring
- freeze and pause checks before spending a fee on a write that would revert
- proof, finalize, and scanner-indexing latency
- fee income, inventory drift, adverse selection, and impermanent-loss accounting
- serialization of account writes, so one record is never spent twice

Narrow ranges concentrate fees, leave range sooner, and demand more management. A
range change is not an edit: decrease, collect, burn, then mint the new range.

## Run it in production

### Operational invariants

Applies to trading and liquidity alike.

1. **One writer per Aleo account**, or explicit reservations. The identity store
   covers blinded identities; input records stay the caller's to partition.
2. **Re-read chain state immediately before every write** — `planSwap`,
   `previewMint`, and `getTradeControls` are the read path.
3. **Treat API and scanner data as asynchronous indexed views**, never as finality.
4. **Hold amounts as raw `bigint`**, converting with `parseUnits` / `formatUnits`
   only at API and display boundaries.
5. **Let the SDK derive what it derives** — DEX host, tick alignment, insert
   hints, record selection, wrapped-ness routing, imports, blinded identities. Each
   hand-rolled substitute is a revert that still costs a fee.
6. **Persist recovery identifiers first** — the `SwapHandle` (the store does this)
   and the `positionTokenId` — before logging, callbacks, or any other fallible
   work.
7. **Retry only when the previous transaction's terminal state is known.**
8. **Keep claim and collection recovery running** even when a kill switch blocks
   new risk.

### What 0.6.0 handles

Three gaps earlier releases left to the integrator are closed.

| Area | 0.6.0 |
| --- | --- |
| Session auth | `client.authenticateShieldSwap()` runs the full challenge/verify handshake (`challenge_id`, session cookie), mints long-lived `ss_…` tokens, and renews a session on 401 |
| Route units | `planSwap` quotes through `client.api.getRoute` and converts with `parseUnits`; no direct HTTP, no hand-rolled decimal math |
| Unclaimed swaps | `getUnclaimedSwaps` reads `swap_outputs` on chain, and `reconcileSwapHistory` recovers swap ids from claim history |

One boundary remains, and it is architectural rather than versioned: every amount
that moves money comes from a chain read, and the DEX API stays an index for
discovery and analytics.

## Sources

- [Shield Swap SDK](https://github.com/ProvableHQ/veil/tree/main/packages/shield-swap)
- [The `shield-swap` command](https://github.com/ProvableHQ/veil/tree/main/packages/shield-swap-cli) — the runnable reference for every flow above
- [Trading runbooks](https://github.com/ProvableHQ/veil/tree/main/packages/shield-swap/skills)
- [Shield Swap API](https://provable.mintlify.io/api-reference/overview)
- [Provable Aleo SDK, scanner, and delegated proving](https://github.com/ProvableHQ/sdk)
