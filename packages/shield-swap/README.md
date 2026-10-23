# @provablehq/shield-swap-sdk

[All Veil packages](../../README.md#packages) · [Documentation](https://provablehq.github.io/veil/packages/shield-swap) · [npm](https://www.npmjs.com/package/@provablehq/shield-swap-sdk) · [LLM index](../../llms.txt)

A viem-shaped TS/JS client for the `shield_swap` AMM on Aleo. The client provides 
viem-style actions for the following:

> **Agents and new traders: start at [`skills/SKILL.md`](./skills/SKILL.md).**
> It is the single entrypoint for using the DEX — account bootstrap
> (registration, invite code, airdrop), pool discovery, private swaps,
> liquidity, and collection, with runnable scripts and failure-mode tables.
> This README documents the SDK surface itself.

### Executing DEX smart-contract functions
Actions for executing the functions of the `shield_swap.aleo` contract.
- **Private swaps** — Runs the `swap` --> `claim_swap_output` flows (a
completely filled swap claims through `claim_swap_output_no_refund` instead,
chosen automatically), and the multi-hop variant (`swap_multi_hop`, claimed
through the same unified `claimSwapOutput` action) for 2–3 pool routes.
- **Liquidity** — create pools (via `create_pool`), 
mint concentrated-liquidity positions (`mint`) and add to them (`increase_liquidity`).

### Reading the DEX contract + DEX API
Actions for:
- Reading Shield Swap smart-contract mappings directly — pools, slots,
positions, ticks, swap outputs, swap execution receipts, pool creators, and
the pause/freeze control gates.
- Reading Shield Swap api endpoints via typed client REST API service namespaced under `client.api`.

### Helpers for Traders
Actions that help traders do common things like check thier private token position balances,
derive pool/tick keys and swap/position ids locally, and pre-flight a pool's
control gates before paying for a transaction.

## Installation

```sh
pnpm add @provablehq/shield-swap-sdk @provablehq/veil-core
```

If you sign with a local private key (bots, scripts, tests) you also need
`@provablehq/sdk`. It is used to derive the blinded identity that private
swaps are claimed with. If your app connects to a wallet instead, the wallet
does that derivation itself and you can skip the dependency.

To drive the DEX from a terminal rather than build against the client, install
`@provablehq/shield-swap-cli` instead — it ships a `shield-swap` command
covering setup, pool and balance reads, swaps, and liquidity.

## Examples

Run the [first-swap example](./examples/first-swap) to create an account,
request test tokens, swap USDCx for ETH, and claim the output. The complete
project lives at `packages/shield-swap/examples/first-swap`; it installs
published packages with `npm ci` and runs with `npm start`. It calls the SDK directly and uses its file-backed identity store
for claim recovery. SDK releases also include
the example under `node_modules/@provablehq/shield-swap-sdk/examples/first-swap`;
copy that directory outside `node_modules` before running it.

Worked examples of everything below live in
[`examples/shield-swap/`](https://github.com/ProvableHQ/veil/tree/main/examples/shield-swap):
account bootstrap, pool reads, quoting, balances, swap history, swaps, minting a
position, rebalancing it to a new range, and taking liquidity back out. Each one
is a single file that reads top to bottom.

For concurrent trades, run the [concurrent-swaps example](../../examples/shield-swap/concurrent-swaps.ts).
It previews a six-record inventory, then submits six swaps and claims their
outputs when called with `--execute`. The [example guide](../../examples/shield-swap/README.md)
covers setup, shared reservations, and recovery after an interruption.

[Open them in StackBlitz](https://stackblitz.com/github/ProvableHQ/veil/tree/main/examples/shield-swap)
to browse the set in an editor. The pool and token reads run there as they are;
anything that signs needs credentials, and a private key does not belong in a
hosted sandbox — run those locally.

## Quote and execute

```ts
const quote = await client.quote({
  from: 'USDCx',
  to: 'ETH',
  amountIn: '1.5',     // decimal input-token units; bigint also accepts raw units
  slippageBps: 50,     // 0.5%; defaults to 50
})
const handle = await client.swap({ quote })
// Persist the handle, then call claimSwapOutput once the output finalizes.
```

`quote` uses the configured DEX API for token metadata, routing and
`estimated_amount_out`. It trusts that estimate and converts it from output-token
decimals using integer arithmetic. It makes no chain reads, performs no local
swap simulation and does not fetch tick data or program sources. API authentication
is required for the route endpoint. The transport MUST specify a network.

Decimal-string inputs are converted using the input token's decimals; bigint
inputs already represent raw base units. Excess precision and JavaScript numbers
are rejected. The agent/MCP quote tool accepts decimal strings in token units.

A quote carries `from`, `to`, `amountIn`, `expectedOut`, `minOut`, `slippageBps`,
ordered `hops`, `network`, `program`, `version`, `quotedAt`, `expiresAt`, and API
protocol revision metadata. Amounts are `bigint`; agent/MCP results encode them as
integer strings. Protocol configuration heights are **not** pool-state snapshot
heights. Quotes are unsigned estimates and do not reserve liquidity.

Quotes expire 60 seconds after the request starts. `swap({ quote })` validates
freshness before and after preparation, checks only the quoted pools on chain,
resolves imports, and selects single- or multi-hop execution automatically.
It submits exactly `minOut`, without re-quoting or applying slippage twice.
Quote expiry does not cancel proving already started; the transaction's block
deadline remains separate. Missing/invalid estimates, disconnected routes and
zero output floors reject. Trade-term overrides alongside a quote also reject.
Wallet accounts still supply `tokenRecord`; proofs, identity, imports and other
execution options remain configurable.

Standalone actions use `quote(client, { api, from, to, amountIn })` followed by
`swap(client, { quote })`. Existing `planSwap`, manual `swap` and `swapMultiHop`
calls remain available. Agent/MCP clients use `shield_swap_quote`, then
`shield_swap_swap({ quote })`; writes remain opt-in.

## Setup

The client signs one of two ways. Pick the one that fits — every DEX method is
identical afterward, and read-only calls (pool state, `client.api`) need
neither, just a transport.

- **Local (programmatic)** — you hold a private key (bots, scripts, tests, CI)
  and configure proving + a record scanner yourself.
- **Wallet** — a connected wallet (Shield, Leo) holds the keys and records and
  proves the transaction; your app carries no key, proving config, or scanner.

### Local (programmatic) client

You provide three things: an account with testnet credits (to pay fees),
proving (delegated as shown, or local), and a record scanner (so the client can
find the private records that swaps and mints spend). Local signing also pulls
in `@provablehq/sdk` — it derives the blinded claim identity.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const aleo = await loadNetwork('testnet')

const scanner = aleo.createRemoteScanner({
  url: 'https://edge.provable.com/api/scanner',
})

const { walletClient, account } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://edge.provable.com/api/v2',
  provingMode: 'delegated',
  proverUrl: 'https://edge.provable.com/api/prove',
  records: scanner,
})

const client = walletClient.extend(
  shieldSwapActions({ api: {} }),
)
```

### Wallet client

The wallet holds keys and records and proves for you — no private key, proving
config, or scanner. Build the client from the adapter's account + transport,
and pass the shield_swap grants at connect time so the wallet may derive the
blinded identity for private swaps and claims on your behalf.

```ts
import { createWalletClient } from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { shieldSwapActions, SHIELD_SWAP_ALGORITHM_GRANTS } from '@provablehq/shield-swap-sdk'

// e.g. a connected Leo/Shield adapter — pass the grants in its connect options:
await adapter.connect(network, decryptPermission, {
  algorithmsAllowed: SHIELD_SWAP_ALGORITHM_GRANTS,
})

const { account, transport } = fromWalletAdapter(adapter)
const client = createWalletClient({ account, transport }).extend(
  shieldSwapActions({ api: {} }),
)
```

Wallet accounts also pass token records differently at call time — the
per-action "local vs wallet" notes under [Swapping](#swapping) and
[Liquidity](#liquidity) cover it.

### The composed client

Either way, `shieldSwapActions` adds the DEX methods to the client. On-chain
reads and writes go directly on the client (`client.getPool`,
`client.swap`), and the off-chain DEX API is namespaced under
`client.api` — so a call site always shows whether a value came from the chain
or the service. By default everything targets `shield_swap.aleo` and the
Provable dev API; override either with
`shieldSwapActions({ program, api: { baseUrl } })`.

### Authenticating with the DEX API

The [API action reference](./API.md) maps every non-admin application endpoint
to its SDK method, including session management, referrals, analytics, and
discovery. These methods are also exposed through agent tools and MCP.

Public market data, including `getFeeTiers()`, needs no credential. Account data, routing, and referral
activity require authentication. Two credentials work:

- **A session JWT** (about 15 minutes), issued by a challenge/verify handshake:
  the API sends a nonce message, the account signs it, and the signature is
  exchanged for the token. On a composed client this is one call:

  ```ts
  await client.authenticateShieldSwap()
  const route = await client.api.getRoute({ token_in, token_out })
  ```

  The signer is retained, so when the session expires the next gated call
  renews it and retries automatically (disable with
  `api: { autoReauthenticate: false }`). Outside the decorator, use
  `authenticateWithAccount(api, account)` or `api.authenticate(address, sign)`
  directly. A browser using HTTP-only cookies can use the separate challenge
  and verification methods with `credentials: 'include'`; see the API reference.

  This action was called `authenticateApi` before. That name survives as a
  deprecated alias and will be removed in the next major: a client can also carry
  `authenticateProvableApi` from `@provablehq/veil-aleo-sdk`, and "the API" does
  not say which of the two it signs into.

- **A long-lived API token** (`ss_…`), minted once under a session JWT and
  passed at construction. Suited to bots, CI, and servers that should not
  re-sign on every boot:

  ```ts
  // One-time provisioning (keep the secret — it is shown only once):
  await client.authenticateShieldSwap()
  const { token } = await client.api.createApiToken({ name: 'trading-bot' })

  // Every run after that:
  const bot = walletClient.extend(shieldSwapActions({ api: { apiToken: token } }))
  ```

  API tokens cover data and trading endpoints; managing tokens themselves
  (`createApiToken`, `listApiTokens`, `revokeApiToken`) always requires a
  session JWT. Revoking a token stops it authenticating immediately.

Authentication alone is not enough: the account must also have redeemed a
**referral code** (the invite codes Shield Swap distributes), or the gated
endpoints return 403 `redeem an invite code to unlock access`. Check and
redeem once per account:

```ts
await client.authenticateShieldSwap()
if (!(await client.api.getReferralStatus()).has_access) {
  await client.api.redeemReferralCode(inviteCode) // one-time; unlocks immediately
}
```

The access grant is recorded server-side against the session, so no second
handshake is needed.

To obtain the account's own code to share, call `client.api.getMyReferralCode()`
after authentication. The server returns an existing personal code or creates
one when issuance is enabled; the returned `code` may be null or absent when
none is available. This call can create a code and does not redeem one.

Calling a gated method with no credential fails fast client-side with the
remedy in the message, rather than surfacing a bare 401.

## Pools and tokens

Pool discovery goes through the API. Each pool entry has the pool key
(every read and swap takes it) plus metadata for both tokens:

```ts
const pools = await client.api.getPools()
const pool = pools.data[0]

pool.key                          // '4719...field'
pool.token0                       // token id, a field literal
pool.token0_info.decimals
pool.token0_info.wrapper_program  // e.g. 'ethx_5a095e.aleo'
```

The `wrapper_program` matters: private token balances live as records inside
each token's wrapper program, and the swap and mint calls need to know which
program to look in.

On-chain state comes in two parts. `getPool` returns static configuration
(token pair, fee tier, decimal scales) and `getSlot` returns live trading
state (current sqrt price, tick, in-range liquidity):

```ts
const config = await client.getPool({ poolKey: pool.key })
const slot = await client.getSlot({ poolKey: pool.key })
```

`getPoolCreator` reads the `pool_creators` mapping — the address that called
`create_pool`, written once at creation and never changed by later admin or
liquidity activity. Pools created before the edition-1 upgrade have no entry,
so a `null` result there means "predates creator tracking," not "no creator":

```ts
const creator = await client.getPoolCreator({ poolKey: pool.key })
```

The pool key can also be derived locally from the token pair and fee tier,
without a `getPools` round trip. `derivePoolKey` computes the same
`BHP256::hash_to_field(PoolKey { token0, token1, fee })` the contract does
(sorting the pair ascending), and `deriveTickKey` does the same for an
individual tick — useful for reading the `ticks` mapping directly, e.g. to
walk `prev`/`next` for an authoritative insertion hint.

```ts
import { derivePoolKey, deriveTickKey } from '@provablehq/shield-swap-sdk'

const poolKey = await derivePoolKey({ token0, token1, fee: 3000 })
const tickKey = await deriveTickKey({ pool: poolKey, tick: -600 })
```

Both load the optional `@provablehq/sdk` peer on first call to hash locally
(same lazy, wallet-free path as the blinded-identity derivation); they are
pure and hit no network otherwise.

## Program imports

`shield_swap` calls token programs through a dynamic dispatch interface, so
the prover can't discover the token programs by static analysis. Every write
takes an `imports` map of program id to program source for the tokens
involved. Fetch the sources once and reuse them:

```ts
import { getProgram } from '@provablehq/veil-core'

const imports = {
  [token0Program]: await getProgram(walletClient, { programId: token0Program }),
  [token1Program]: await getProgram(walletClient, { programId: token1Program }),
}
```

That map is incomplete on its own: the prover also needs `shield_swap`'s own
static imports, and a swap submitted without them fails with "its import … must
be added first". `resolveDexImports` collects both halves, and it is available on
the composed client:

```ts
const imports = await client.resolveDexImports({
  tokenPrograms: [token0Program, token1Program],
})
```

## Swapping

A private swap takes two transactions. The first submits the swap request;
when it finalizes, the chain computes the actual output and stores it in a
mapping. The second transaction claims that output, which lands in your
account as private records.

### Request the swap

Quote the trade first — the quote feeds the slippage check: the swap reverts on
chain if the output falls more than `slippageBps` below `expectedOut`. Omit
`expectedOut` and a spot-price estimate is used, which ignores fees and price
impact, so pass a real quote for anything beyond a tiny trade.

```ts
const route = await client.api.getRoute({
  token_in: tokenIn,
  token_out: tokenOut,
  amount_in: amountIn,
})

// estimated_amount_out is a display decimal in the output token's units.
// expectedOut wants raw base units (u128), so scale by the token's decimals:
const expectedOut = BigInt(Math.floor(Number(route.data.estimated_amount_out ?? 0) * 10 ** tokenOutDecimals))
```

`swap` returns a plain serializable handle — the key to claiming your
output. Persist it if there's any chance your process dies before the claim.
How you supply the input record differs by signer.

#### Local

The client auto-selects an unspent record covering `amountIn` from
`tokenInProgram` (your token's wrapper program) and derives the single-use
claim identity from your view key. The returned handle is complete — it already
carries `swapId` and `blindedAddress`.

```ts
const handle = await client.swap({
  poolKey,
  tokenInId: tokenIn,
  amountIn,                                   // raw atomic amount, bigint
  expectedOut,                                // scaled to base units above
  slippageBps: 50,                            // 0.5%
  tokenInProgram,                             // the token's wrapper program
  imports,
})
```

#### Wallet

A wallet never exposes its records, so drop `tokenInProgram` and pass
`tokenRecord` as a `record` InputRequest — the wallet resolves it against its
own records (`filters` pick one covering the amount) and fills the blinding
slots itself. The returned handle therefore comes back **without** `swapId` or
`blindedAddress`; see the wallet claim case below for recovering them.

```ts
const handle = await client.swap({
  poolKey,
  tokenInId: tokenIn,
  amountIn,
  expectedOut,                                // scaled to base units above
  slippageBps: 50,
  imports,
  tokenRecord: {
    type: 'record',
    program: tokenInProgram,      // the token's wrapper program
    recordname: 'Token',
    filters: { amount: { gte: `${amountIn}u128` } },
  },
})
```

### Claim the output

Claiming reads the chain-computed output and collects it as private records. If
it throws `SwapOutputNotFinalizedError`, the request transaction hasn't
finalized yet; retry after a few blocks. The same error after a successful claim
means the output was already collected — claiming consumes the on-chain entry.

Confirm the swap and wait for its output mapping to become readable:

```ts
await client.waitForSwapOutput({ handle })
const claim = await client.claimSwapOutput({ handle })
```

`waitForSwapOutput` confirms the transaction first, then polls its output mapping.
Both stages share a 15-second timeout and a three-second polling interval.
A rejected transaction fails immediately.
Override `timeout` and `pollingInterval` in milliseconds when needed. It never
submits a transaction. A timeout can also mean the output was already claimed;
recover the existing handle instead of starting another trade.

`claimSwapOutput` resolves required token program sources from chain automatically;
`imports` is an optional override for callers with cached sources. The handle
does not need to contain program sources.

`claimSwapOutput` picks the transition automatically from the chain-read
remainder: a swap that filled completely (`amountRemaining` is `0n`) claims
through `claim_swap_output_no_refund` — or the router's
`claim_to_arc20_no_refund` / `claim_to_wrapped_no_refund` when either token is
wrapped — which produces no refund record. A nonzero remainder claims through
`claim_swap_output` or its wrapped-aware router counterparts instead, and pays
back the unfilled input alongside the output. Either way the call and its
return shape are the same; `amountRemaining` in the result says which path was
taken.

#### Local

The handle already carries `swapId` and `blindedAddress`, so the claim just
works:

```ts
const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle })
```

#### Wallet

The wallet filled the blinding slots at request time, so the handle came back
without `swapId`/`blindedAddress`. Recover them from the confirmed request
transaction first — `swapId` is the transition's first public output, and the
blinded address is the `recipient` of the chain's `swap_outputs` entry, read
with `getSwapOutput` once the request finalizes — set them on the handle, then
claim. The wallet re-derives the blinding factor from the
blinded address itself, so you never hold it.

The handle carries the full swap-id preimage (`zeroForOne`, `sqrtPriceLimit`,
`nonce`), so once you have the blinded address you can also compute the id
locally instead of digging it out of the transaction:

```ts
handle.blindedAddress = blindedAddressFromConfirmedTx
handle.swapId = await deriveSwapId({
  poolKey: handle.poolKey,
  zeroForOne: handle.zeroForOne!,
  amountIn: handle.amountIn,
  sqrtPriceLimit: handle.sqrtPriceLimit!,
  blindedAddress: handle.blindedAddress,
  nonce: handle.nonce!,
})

const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle })
```

### Auditing a settled swap

`getSwapExecution` reads the execution receipt the chain writes when a swap
request finalizes — the pool, direction, input and output amounts, fee paid,
protocol fee, and the resulting price and tick for each hop. Unlike
`swap_outputs`, the claim does not consume this entry, so it stays readable
after the swap is fully settled:

```ts
const receipt = await client.getSwapExecution({ swapId: handle.swapId! })
const totalLpFee = receipt?.hops.reduce((sum, hop) => sum + hop.lp_fee, 0n)
```

Each hop's `lp_fee` is derived client-side as `fee_paid - protocol_fee` — the
liquidity providers' share once the protocol's cut is set aside. Swaps
executed before the edition-1 upgrade have no receipt; `getSwapExecution`
returns `null` for those, same as for a request that has not finalized yet.

### Multi-hop routes

When the best route crosses more than one pool, `swapMultiHop` submits the
whole 2–3 hop route as one atomic transaction — the intermediate tokens never
touch your account. Pass the pool keys in route order (the API's `/route`
returns them); the client walks your input token through each pool's pair to
fix the hop directions and the final output token, and rejects a route that
does not connect. A single-hop trade stays on `swap` — the contract requires
at least two hops here.

```ts
const handle = await client.swapMultiHop({
  poolKeys: [ethUsdcPool, usdcAleoPool],   // ETH → USDC → ALEO
  tokenInId: ethTokenId,
  amountIn,
  expectedOut,                             // quote for the FINAL output token
  slippageBps: 50,                         // applied once, end to end
  tokenInProgram,                          // local key; wallets pass tokenRecord
  imports,
})
```

The handle is the same idea as the single-hop one — serializable, carries the
whole id preimage, consumed by the claim. `claimSwapOutput` handles both
handle types identically; `swap_outputs` carries only the route's final output
token and one remaining amount, so a multi-hop claim reads the same way a
single-hop one does:

```ts
const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle })
```

Signer paths, `SwapOutputNotFinalizedError`, and the wallet-path recovery
story all match the single-hop flow (the local helper there is
`deriveMultiHopSwapId`, and unlike the single-hop preimage it includes the
deadline).

Multi-hop swaps confirm more slowly than anything else in this SDK — one has
been measured at 322 seconds, against a default confirmation window of 60. A
client that submits them should say so at construction:

```ts
const { walletClient } = aleo.createAleoClient({ /* … */, confirmationTimeout: 400_000 })
```

Leave it at the default and a multi-hop swap that is merely slow reports
`TransactionTimeoutError` and then confirms anyway — after which resubmitting
earns a `DuplicateTransactionError`. The window is per client, so a client doing
both liquidity writes and multi-hop swaps takes the longer value; check
`error.absentPolls` against `error.polls` on a timeout to tell a transaction the
node never had from one it simply had not confirmed yet.

### Concurrent swaps

Concurrent swaps need separate input records and separate blinded identities.
Enable `recordManagement: { enabled: true, store, chainId }` when creating the
wallet client to coordinate records. If two automatic selections choose the same
record, `swap` and `swapMultiHop` retry with another eligible record before
proving. Candidates are tried from smallest to largest, once per nonce. Explicit
`tokenRecord` inputs remain fixed, and execution errors are not retried.

Each swap also needs a single-use blinded identity. `shieldSwapActions` supplies
an in-memory identity store by default, shared by calls through that client. Use
a durable store to retain identities and claim handles after a restart:

```ts
import { swapFileStore } from '@provablehq/shield-swap-sdk/node'

// walletClient was created with recordManagement.enabled: true.
const client = walletClient.extend(
  shieldSwapActions({ api: {}, blindedIdentities: swapFileStore('.veil/blinded.json') }),
)

// Requires at least two available USDCx records, each covering amountIn.
const results = await Promise.allSettled([
  client.swap({ poolKey: poolA, tokenInId: usdc, amountIn, imports }),
  client.swap({ poolKey: poolA, tokenInId: usdc, amountIn, imports }),
])
// Claim every fulfilled result, even if another swap failed.
```

`swapFileStore` is an alias of `fileBlindedIdentityStore`. Each swap reserves its
identity before submission and saves its handle after confirmation;
`claimSwapOutput` marks it claimed. Concurrent clients in one process MUST share
the same identity store instance as well as the record store and chain identity.

The bundled identity stores do not coordinate counters across processes. SQLite
can coordinate record reservations across processes, but a shared identity file
alone cannot prevent two processes from deriving the same blinded address.
Use distinct explicit identities when managing concurrent swaps across processes.

Record coordination remains off by default. Without it, callers MUST supply
disjoint input records or trade sequentially. See the
[record inventory guide](../../site/docs/guides/record-inventory.md#concurrent-swaps)
for retry boundaries and storage configuration.

To opt a single call out of tracking, pass `blindedIdentities: undefined`; the
identity is then derived by scanning the chain and nothing is written. The
standalone `swap(client, params)` export tracks only when handed a store, so it
behaves as it always has unless you pass one.

`syncBlindedIdentities` reconciles the store against chain: `swapped` while the
output is still in `swap_outputs`, `claimed` once a claim consumes it. Recorded
handles make those states actionable rather than merely informative, since a claim
consumes a whole handle and not a swap id.

`getUnclaimedSwaps` is the summary of what that leaves owed, and the crash-recovery
path — a process that died between a swap and its claim can finish the job from the
store alone:

```ts
const { swaps, totals, claimable, unresolvable } = await client.getUnclaimedSwaps()

for (const [tokenId, amount] of Object.entries(totals)) {
  console.log(`${tokenId}: ${amount} owed`) // raw base units, both sides of every swap
}

for (const swap of swaps) {
  if (swap.claimable) await client.claimSwapOutput({ handle: swap.handle! })
}
```

It reads `swap_outputs` rather than trusting stored statuses, so the answer is
current whether or not sync has run — an entry appears exactly when a claim would
succeed. `totals` counts both sides, because a claim pays the output token and
refunds whatever of the input went unfilled. `claimable` is how many entries carry
a handle; an entry without one is visible but cannot be claimed from here, since
`claimSwapOutput` needs the whole handle.

`unresolvable` is the honest gap: identities the chain has consumed whose swap id
the store never recorded. Nothing on chain maps an identity to its swap until a
claim exists, so there is no lookup to make — those need
`reconcileSwapHistory`, and only once something has claimed them.

This applies to local accounts only. A connected wallet derives its identities
behind resolve-mode input requests, so the client never sees them — a wallet
client's store is left untouched rather than being wrong, and
`reserveBlindedIdentity` rejects one outright.

#### One failure worth knowing about

If a swap lands but the store cannot be written, `swap` throws
`SwapRecordingError` **after** a successful submission. Do not resubmit: the
transaction is on chain and a second one spends more input. The error carries the
handle, so persist it and claim with it:

```ts
try {
  await client.swap({ poolKey, tokenInId, amountIn, imports })
} catch (error) {
  if (error instanceof SwapRecordingError) await myBackup.save(error.handle)
  throw error
}
```

It throws rather than warns because the swap id is knowable at that moment and
unknowable afterwards — nothing on chain ties an identity to its swap until a
claim exists, so a lost handle means proceeds that cannot be claimed. The claim
side does the opposite: if marking a claimed identity fails, it warns and
continues, because the funds are already in the account and
`reconcileSwapHistory` can repair the record later.

#### Managing identities yourself

Passing `blindedIdentity` explicitly opts out per call, whether or not a store is
configured. The store is left untouched and the bookkeeping is yours:

```ts
import { nextBlindedIdentity, viewKeyToScalar } from '@provablehq/shield-swap-sdk'

const identity = await nextBlindedIdentity(client, {
  viewKeyScalar: await viewKeyToScalar(account.viewKey),
  signer: account.address,
  startCounter: myLastUsedCounter + 1,
})
const handle = await client.swap({ poolKey, tokenInId, amountIn, blindedIdentity: identity, imports })
await myDatabase.save(handle) // persist it — the claim consumes it
```

There is no flag to disable tracking, because this is the flag: an explicit
identity means you are managing it. Collision safety still comes from the chain
check `nextBlindedIdentity` performs on every candidate, but the gap between that
check and your submission is yours to close — that gap is exactly what a store
exists to serialize.

#### Initializing the history on first run

A new store knows nothing, and an account that has swapped before has a past the
store cannot see. Blinded identities are derived rather than recorded anywhere the
account can read, and the `swap_outputs` entry for a claimed swap is deleted by
the very claim that settles it — so the only public trace linking an identity to
its swap is the `claim_swap_output` (or `claim_swap_output_no_refund`, for a
swap that filled completely) call itself. Its inputs carry the blinded
address, the swap id, both token ids, and the amounts.

`reconcileSwapHistory` walks those calls and writes back what it finds. Run it
once when adopting a store for an account that already has history:

```ts
const { claims, complete } = await client.reconcileSwapHistory({ maxPages: 40 })
for (const claim of claims) {
  console.log(claim.swapId, claim.tokenOut, claim.amountOut)
}
if (!complete) console.warn('history walk truncated — raise maxPages and run again')
```

It stops as soon as every identity in the store is accounted for, so a store that
is already current usually costs a single page. It is expensive otherwise — one
request per page plus one per claim call it examines — which is why it is a
separate action rather than part of routine reconciliation. Check `complete`
rather than assuming the walk reached the end; `false` means older claims may
exist beyond `maxPages`.

What it cannot do is find swaps that were never claimed, because an unclaimed swap
has no claim call. Those come from `syncBlindedIdentities` and the `swap_outputs`
mapping, and only for identities the store already holds — which is the real
argument for a durable store rather than a fresh one each run.

Day to day, `syncBlindedIdentities` is the cheap one and is safe to call at every
startup. `reconcileSwapHistory` is for first adoption and for recovering from a
lost or replaced store.

#### Bringing your own store

`BlindedIdentityStore` is two methods, so anything that can hold a list of records
qualifies — a database table, a keychain entry, an encrypted blob, a remote
service:

```ts
import type { BlindedIdentityStore } from '@provablehq/shield-swap-sdk'

const store: BlindedIdentityStore = {
  load: async () => db.query('select * from blinded_identities where account = $1', [address]),
  save: async (records) => db.replaceAll('blinded_identities', address, records),
}
```

`load` returns every known record in any order, and `save` replaces the stored set
wholesale — reservation reads all known counters to pick the next one, so a store
that cannot enumerate cannot serve it. Implementations need not be concurrency
safe across processes: the actions serialize callers within one process and
re-check the chain before handing out a counter, but two processes sharing an
account should share one store.

One caveat worth designing around: records carry no account or program. Identities
are derived from view key, signer, and program together, so records from a
different account or deployment are meaningless — key your storage by those, as
the file store does by path.

## Liquidity

Positions are concentrated-liquidity ranges, held as private records. Both
mint and increase spend token records, so — like [swapping](#request-the-swap)
— they differ by signer: a local key auto-selects records, a wallet supplies
them as `record` InputRequests.

### Preview a mint

A deposit is not the pair of amounts you offer — it is what the range consumes
out of them, and the two differ at every price except the one your amounts happen
to balance at. `previewMint` reports the difference before you sign: the bounds
after alignment to the pool's tick spacing, the liquidity the budget backs there,
and how much of each side the mint actually takes. It reads three mappings and
writes nothing.

Give it explicit ticks, or a `rangePercent` half-width in percent of the current
price (the default is 5, so ±5% around the market):

```ts
const preview = await client.previewMint({
  poolKey,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  rangePercent: 5,
})

if (preview.liquidity === 0n) throw new Error('that budget backs nothing over this range')
if (!preview.inRange) console.log('the price sits outside the range — it will earn nothing yet')

await client.mint({
  poolKey,
  tickLower: preview.tickLower,
  tickUpper: preview.tickUpper,
  amount0Desired: preview.amount0,   // what the range consumes, not the budget
  amount1Desired: preview.amount1,
  recipient: account.address,
  withdrawal: account.address,
  imports,
})
```

`feeTierSpacing` comes back alongside the pool's own `tickSpacing`. They agree on
a healthy pool; when they do not, the pool has drifted from the fee tier it was
created under, and the pool's spacing is the one the contract aligns to.

### Mint a position

Pick a tick range around the current price; ticks are rounded to the pool's
tick spacing automatically. Returns the new position's token id.

#### Local key

Auto-selects the two token records from `token0Program`/`token1Program`.

```ts
const slot = await client.getSlot({ poolKey })

const { positionTokenId } = await client.mint({
  poolKey,
  tickLower: slot.tick - slot.tick_spacing * 10,
  tickUpper: slot.tick + slot.tick_spacing * 10,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  token0Program,
  token1Program,
  imports,
})
```

#### Wallet

Drop the two `*Program` fields and pass `token0Record`/`token1Record` as
`record` InputRequests (same shape as the swap's `tokenRecord`); the wallet
resolves each against its own records. `positionTokenId` still comes back
filled when `@provablehq/sdk` is installed — every field of the id's
preimage is client-known, so the client hashes it locally instead of waiting
for confirmation. Without the peer it is `undefined`; compute it later with
`derivePositionTokenId`.

```ts
const { positionTokenId } = await client.mint({
  poolKey,
  tickLower: slot.tick - slot.tick_spacing * 10,
  tickUpper: slot.tick + slot.tick_spacing * 10,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  imports,
  token0Record: { type: 'record', program: token0Program, recordname: 'Token', filters: { amount: { gte: `${amount0Desired}u128` } } },
  token1Record: { type: 'record', program: token1Program, recordname: 'Token', filters: { amount: { gte: `${amount1Desired}u128` } } },
})
```

### Add to a position

The tick range is fixed at mint; `increaseLiquidity` adds funds to an
existing position without changing it.

#### Local key

Auto-selects the position NFT (by `poolKey`) and the two token records.

```ts
await client.increaseLiquidity({
  poolKey,
  amount0Desired,
  amount1Desired,
  token0Program,
  token1Program,
  imports,
})
```

#### Wallet

Supply the position and both token records as `record` InputRequests. The
position NFT is a record of the shield_swap program itself:

```ts
await client.increaseLiquidity({
  poolKey,
  amount0Desired,
  amount1Desired,
  imports,
  positionRecord: { type: 'record', program: 'shield_swap.aleo', recordname: 'PositionNFT', filters: { pool: { eq: poolKey } } },
  token0Record: { type: 'record', program: token0Program, recordname: 'Token', filters: { amount: { gte: `${amount0Desired}u128` } } },
  token1Record: { type: 'record', program: token1Program, recordname: 'Token', filters: { amount: { gte: `${amount1Desired}u128` } } },
})
```

### Rebalance a position

`rebalancePosition` moves a position to a new tick range atomically through
`shield_swap_rebalance_router.aleo`: close the old range, collect its
principal and all accrued fees, optionally add funds from private records,
and remint at the successor range — in one transaction that lands whole or
not at all. The successor NFT keeps the position's owner and withdrawal
address; any surplus returns to the withdrawal address as private records.

Sizing takes exactly one of two modes: an exact `liquidityTarget`, or a
`maxFunding0`/`maxFunding1` budget of additional funds — the planner solves
for the largest liquidity the budget supports. `{ maxFunding0: 0n,
maxFunding1: 0n }` rebalances using only what the old position returns.

The contract re-derives and asserts every amount at execution, so a price
move between building and execution reverts the transaction — no funds move,
but the fee is paid. Expect occasional reverts on active pools; rebuild and
resubmit. Keep `deadlineOffsetBlocks` short (default 20) and do not cache
plans.

#### One call

```ts
const { positionTokenId: successorId } = await client.rebalancePosition({
  poolKey,
  positionTokenId,
  tickLower: -1200,
  tickUpper: -600,
  maxFunding0: 0n,
  maxFunding1: 0n,
  imports,
})
```

Wallet accounts also supply the position record and, when the plan funds a
side, that side's record (a wrapped side funds with the UNDERLYING asset's
record):

```ts
const plan = await client.planRebalance({ poolKey, positionTokenId, tickLower, tickUpper, liquidityTarget })
await client.rebalancePosition({
  poolKey,
  positionTokenId,
  tickLower,
  tickUpper,
  liquidityTarget,
  imports,
  positionRecord: { type: 'record', program: 'shield_swap.aleo', recordname: 'PositionNFT', filters: { pool: { eq: poolKey } } },
  token0Record: { type: 'record', program: token0Program, recordname: 'Token', filters: { amount: { gte: `${plan.funded0}u128` } } },
})
```

#### Bring your own state, math, or plan

`planRebalance` is a convenience, never a requirement. Both it and the
one-call form accept pre-read chain state (`pool`, `slot`, `position`,
`lowerTick`, `upperTick`, the token routes) from a caller's own indexer,
skipping the corresponding node reads. A caller that computes the accounting
itself builds the same fields directly — the exported `feeGrowthInside`,
`feeOwed`, `amountsForLiquidity`, `liquidityForAmounts`, and
`selectRebalanceEntry` are the same building blocks the planner uses — and
spreads them into the call, where they are submitted verbatim:

```ts
await client.rebalancePosition({ ...plan, imports })
```

Only chain *state* is accepted piecemeal; the derived assertion set
(`recovered`, `funded`, `refund`, the deposit) travels together as a plan,
which succeeds or reverts as a unit.

### Create a pool

A single public transaction — identical on both signer paths (no records
involved). The fee tier must be one the program has registered (validated
before submission), and the tick spacing is derived from it:

```ts
const { poolKey } = await client.createPool({
  token0ProgramId,
  token1ProgramId,
  fee: 3000,       // in pips: 0.30%
  initialTick: 0,  // sets the opening price
})
```

## Pre-flight controls and position reads

The contract gates every trade behind a set of admin controls — a global
pause, per-token pauses, per-pair pauses, and each pool's `enabled` flag —
and asserts them at finalize, where a violation costs you a proved, fee-paid
revert. `getTradeControls` reads every gate for a pool in one call and
reports the same conjunction the finalize checks:

```ts
const controls = await client.getTradeControls({ poolKey })
if (!controls.tradeable) {
  console.log('blocked:', controls)   // which gate, exactly
}
```

The individual readers are there too when you need one gate —
`isGlobalPaused`, `isTokenPaused`, `isPairPaused`, `isTokenAllowed` (gates
pool creation, not trading), `isPoolCreationOpen`, and `getFrozenPosition`
(a frozen position blocks liquidity operations until unfrozen). Control
state can change before your transaction finalizes, so treat a green read
as advisory.

Two more chain reads round out reconciliation after liquidity operations:
`getPosition` returns a position's public state by its token id (liquidity,
range, and the `tokens_owed` balances that `decreaseLiquidity` and fee
accrual settle into), and `getTick` returns an initialized tick — pass
`{ poolKey, tick }` to derive the key locally, or a pre-derived `tickKey`
to stay off the WASM peer.

## Owned positions

`getOwnedPositions` scans the account's PositionNFT records and returns every
live position joined with its on-chain state — liquidity, the current token
amounts behind it, and the fees it could collect today. The private record
carries the identity (pool, range, withdrawal address) and the public
mappings carry the amounts; the action does the join and the two contract
calculations (`view_amounts_for_liquidity`, fee-growth settlement) so a
wallet or bot does not have to persist token ids or re-derive the math.
`getOwnedPosition` resolves a single position by its token id. Both need
record access (a connected wallet, or a local account with a record
provider).

An entry's `state` is `null` whenever the public mapping carries no entry for
it, and that happens at both ends of a position's life. Just after a mint the
record arrives before the mapping, so the position is real and its state is
still landing. Just after a burn the reverse holds — the record scanner marks
records spent on its own schedule, and has been measured still serving a burned
position more than four minutes after the burn confirmed — so the entry is a
position that no longer exists. Treat a `null` state as "not a live position"
rather than as a value still loading, and read `getPosition` when the difference
matters.

```ts
const positions = await client.getOwnedPositions()
for (const p of positions) {
  console.log(p.positionTokenId, p.state?.amount0, p.state?.uncollectedFees0)
}
```

## Deriving keys and ids locally

Every id the contract computes by hashing a struct is computable client-side,
without the network: `derivePoolKey` and `deriveTickKey` for mapping keys,
`deriveSwapId`, `deriveMultiHopSwapId`, and `derivePositionTokenId` for the
ids that swaps and mints produce. The actions already fill these into their
returns wherever the preimage is known (see the swap and mint sections), so
reach for the helpers directly when reconstructing an id after the fact —
say, a wallet-path swap persisted before confirmation — or when addressing
state you have not touched yet.

All of them load the optional `@provablehq/sdk` peer for the BHP256 hash on
first use; pool and price reads never need it.

## Balances

Three views, depending on what you want:

```ts
// Private — summed from your unspent records (what you can spend privately).
await client.getPrivateBalances({ programs: [token0Program, token1Program] })
// { 'ethx_5a095e.aleo': 3000000000000000000n }

// Public — each AMM token program's on-chain `balances` mapping, for any address.
await client.getPublicBalances({ user: address, programs: ['test_arc20_eth.aleo'] })
// { 'test_arc20_eth.aleo': 5000000000000000000n }

// Combined — public + private + total per token, keyed by token id. The API's
// token registry supplies the program list; both balance sides come from chain.
await client.getBalances()
// { '1223…045field': { symbol: 'ETHx', decimals: 18, public: 5n, private: 3n, total: 8n }, … }
```

`getBalances` composes the other two: it pulls the token registry from the API
(so you don't hand it a program list), reads public balances, sums your private
records, and joins them per token. It defaults to your account's address and,
unless you pass a `tokens` filter, returns only tokens you actually hold.

## Units and formats

- Token amounts are raw atomic units, typed `bigint`. Ticks and fees fit in
  `number`.
- Fees are in pips (`3000` = 0.30%). Slippage is in basis points (`50` = 0.5%).
- Pool keys and token ids are Aleo field literals including the suffix, e.g.
  `'4719...field'`.
- Fields read from chain keep their wire names (`amount_out`, `tick_spacing`).

## Codegen

The typed layer (contract types + decoders in `src/generated/`, and the
`ApiClient` response types in `src/api/openapi.ts`) is generated from the
contract's ABI and the API's OpenAPI spec, both pinned under
[`codegen/`](./codegen). The package ships that output.

**When to use it.** Not as a consumer — installing `@provablehq/shield-swap-sdk` gives you
the generated bindings already. You reach for codegen as a maintainer, when the
upstream shapes drift out from under those bindings:

- the contract is **redeployed** or gains/changes an entrypoint, struct, or mapping,
- the DEX API adds or **renames** an endpoint or field, or
- you want the client to **target a different deployment** than the one it ships against.

When none of that has happened, don't run it — the checked-in output is the
source of truth, and regenerating against a moving testnet just produces noise.

**How to use it.** Run the relevant step from the package root, then review and
commit the regenerated files — the git diff is the point, it shows exactly what
drifted:

```sh
pnpm regen-abi       # refetch the program bytecode + ABI JSON → codegen/abi/
pnpm generate        # ABI → src/generated/shield_swap.ts (types, decoders, PROGRAM_ID)
pnpm regen-openapi   # refetch the OpenAPI spec → src/api/openapi.ts
```

Typically it's one of these, not all three: `regen-openapi` for an API change,
`regen-abi` + `generate` for a contract change (`generate` alone is enough if
you only edited `codegen/veil.config.json`). To retarget a deployment, point
`veil.config.json` at another program's ABI — or set its `programId` to stamp a
different `PROGRAM_ID` while keeping the current shape — then `generate`.
[`codegen/README.md`](./codegen/README.md) has the layout details.

## Integration tests

The tests under [`test/integration/`](./test/integration) run against the **real**
testnet node and DEX API — never mocked — so they catch upstream drift as well as
regressions. They're gated behind environment variables so the default
`pnpm vitest run` stays fast and offline; the integration files skip unless you
opt in. They double as the most complete usage examples in the repo.

There are two tiers of gating. The read-only tier needs only `VEIL_INTEGRATION=1`.
The write tier additionally needs a funded testnet account, because it
broadcasts real transactions and pays fees. Delegated proving and record scanning
run on the Provable gateway and need no credentials. Most DEX API
endpoints are bearer-gated, so the API-auth suites also need the account key —
it signs the challenge, no fees involved:

```sh
VEIL_INTEGRATION=1          # enables every integration test
VEIL_E2E_PRIVATE_KEY=...    # testnet account — signs DEX API auth; write tier needs it funded (pays fees)
```

| File | Tier | What it exercises |
| --- | --- | --- |
| [`traders.integration.test.ts`](./test/integration/traders.integration.test.ts) | read-only | The analyses a trader runs before trading — spot price, price impact and output size from live liquidity, route quoting with slippage sizing, in-range LP position selection, and fee-APR from OHLCV volume. Asserts math invariants, not exact live figures. The OHLCV test needs `VEIL_E2E_PRIVATE_KEY` (bearer-gated endpoint). |
| [`reads.integration.test.ts`](./test/integration/reads.integration.test.ts) | read-only | Chain-direct reads (pools, slots, fee tiers, validation) against live state. |
| [`api.integration.test.ts`](./test/integration/api.integration.test.ts) | read-only | The off-chain `ApiClient` — public pool, token, and fee-tier discovery without credentials, plus invalid-credential rejection on WebSocket tickets. With `VEIL_E2E_PRIVATE_KEY`, exercises authenticated reads, auto re-auth after expiry, and the API-token lifecycle (mint, use, list, revoke — self-cleaning). |
| [`balances.integration.test.ts`](./test/integration/balances.integration.test.ts) | write | The composed balance view — public balances from the API joined with private balances decoded from the account's records. Needs the account because private balances live in its records. |
| [`e2e.test.ts`](./test/integration/e2e.test.ts) | write | The full private-swap lifecycle — airdrop, privatize records, ensure a pool, `swap`, read the output, `claimSwapOutput`. |

Run one file, or a set:

```sh
# Read-only tier — no account needed
VEIL_INTEGRATION=1 pnpm exec vitest run packages/shield-swap/test/integration/traders.integration.test.ts

# Write tier — needs the funded account + proving credentials above
VEIL_INTEGRATION=1 pnpm exec vitest run packages/shield-swap/test/integration/e2e.test.ts

# The whole integration suite
VEIL_INTEGRATION=1 pnpm exec vitest run packages/shield-swap/test/integration
```

A test that reports as skipped is missing a required variable for its tier. The
write tier spends real testnet funds on each run. Optional overrides:
`VEIL_DEX_PROGRAM` (defaults to `shield_swap.aleo`), `ALEO_DPS_URL`, and
`ALEO_RSS_URL`.

## Frozen-signer tests

The offline [`frozenSigners.test.ts`](./test/actions/frozenSigners.test.ts) uses
real SDK Merkle proofs against populated fixture trees. It checks rejection in
single-hop and multi-hop wrapped swaps, AMM claims, wrapped outputs, and wrapped
refunds, plus an unfrozen-signer control. Chain state and transaction submission
are fixtures in this file.

The live [`frozenSigners.integration.test.ts`](./test/integration/frozenSigners.integration.test.ts)
reads the current **testnet** lists and discovers pools from the DEX API. Export
`FROZEN_ADDRESS_1` and `FROZEN_ADDRESS_2`, then run:

```sh
VEIL_FROZEN_TESTS=1 pnpm exec vitest run packages/shield-swap/test/integration/frozenSigners.integration.test.ts
```

Each variable accepts an Aleo address or its private key. For a private key, the
test derives the address locally and discards the signing account; it never logs
the key or installs a transaction prover. These tests make real SDK swap calls
through automatic proof generation, but do not sign, broadcast, or spend funds.

Each account MUST be frozen on `test_usdcx_freezelist.aleo` or
`shield_swap_freezelist.aleo`; otherwise its fixture check fails. Token-list
membership enables the wrapped single-hop and two-hop rejection checks. AMM-list
membership enables rejection of the claim's signer proof against the current
root, without opening an unclaimable swap. Checks for lists that do not contain
the account report as skipped. The swap checks use omitted and `null` proofs;
only `Address is frozen` counts as the expected rejection. RPC failures, stale
trees, or invalid roots fail the test.

Core swap submission has no AMM freezelist check: that check occurs when claiming.
These tests verify SDK proof rejection, not consensus rejection of a submitted
transaction or wallet-side proof generation. `VEIL_FROZEN_TESTS` is separate from
`VEIL_INTEGRATION`, so the ordinary live suites do not require frozen accounts.

## Quote integration test

`test/integration/quote.e2e.test.ts` verifies quotes, successful swap finalization,
on-chain hop receipts, and claims for direct and multi-hop routes. It runs only
with `VEIL_INTEGRATION=1` and `VEIL_QUOTE_E2E=1`, a funded testnet
`VEIL_E2E_PRIVATE_KEY`, and `VEIL_QUOTE_E2E_CASES` containing explicit input/output
tokens, raw input amounts and expected hop counts. See the test's header for the
fixture format. Both route shapes are validated before any funds are spent.
A deployment whose API always selects direct routes needs a separate multi-hop
fixture topology; the test fails rather than silently skipping that coverage.

<a id="freezelist-proofs"></a>

## Compliance

Swaps and liquidity actions on Shield Swap use Merkle exclusion proofs to prove
in zero knowledge that participating private addresses are not on a known
freezelist.

Callers construct these Merkle exclusion proofs locally, through the SDK or
connected wallet, and supply them as private inputs to Aleo's zk-SNARKs. The
Merkle checks run during transaction proving; the network verifies the resulting
zero-knowledge proof. This establishes that participating addresses are absent
from the freezelist without publicly revealing those addresses or the Merkle
paths. These compliance checks preserve the privacy of the addresses making
swaps or managing liquidity.

Compliance proof generation is enabled by default in the Shield Swap SDK.
With a local SDK client or a compatible wallet connected with the required
algorithm grants, callers need no manual proof generation, provider, or cache.
Omit `proofs` to use the default. Wallets need the algorithm support and
connection grants described below, and opaque position records need the
withdrawal address for automatic proofs.

### Functions that require compliance proof inputs

The following public SDK functions resolve Merkle exclusion proofs. Each bundle
is an encoded `[MerkleProof; 2]`: two Merkle paths proving that one address is
absent from one freezelist. Counts below are transaction input slots, including
wrapper placeholders, rather than the number of distinct bundles to generate.

| Function | Bundle slots | Subjects in transaction input order |
| --- | --- | --- |
| `swap()` | 0 to 1 | Input-token sender, only for a wrapped input |
| `swapMultiHop()` | 0 to 1 | Input-token sender, only for a wrapped input |
| `claimSwapOutput()` | 1 to 3 | Shield Swap signer, then wrapped output receiver and wrapped refund receiver if refunded |
| `mint()` | 3 to 5 | Wrapped token senders, then Shield Swap signer, position recipient, and withdrawal address |
| `increaseLiquidity()` | 0 to 2 | Wrapped token senders |
| `collect()` | 2 to 4 | Shield Swap position owner and withdrawal address, then wrapped token receivers |
| `rebalancePosition()` | 2 to 6 | Funded wrapped token senders, wrapped token receivers, then Shield Swap position owner and withdrawal address |

Shield Swap proofs use the AMM freezelist; wrapped-token proofs use the
underlying token's freezelist. Senders are the signer. Claim receivers are also
the signer; collect and rebalance receivers are the PositionNFT's withdrawal
address. These lists and subjects determine which bundles can be reused.

Within each wrapper group, side 0 precedes side 1. Plain sides consume no wrapper
proof slot. A credits wrapper has a placeholder slot but no exclusion check.
Rebalance receiver slots remain present even when a side has no refund.
Intermediate hops in `swapMultiHop()` add no caller-supplied proof slots.
`decreaseLiquidity()` and `burn()` require no exclusion proofs; withdrawing
proceeds through `collect()` does. Plain-input swaps and increases involving
only plain tokens also require none.

### Automatic generation

Proofs are generated automatically when `proofs` is omitted or `null`. Local
accounts use the generator supplied by `@provablehq/veil-aleo-sdk`, including
when transaction proving is delegated. Wallet accounts emit
`program-freezelist-exclusion-proof` requests; connect with
`shieldSwapAlgorithmGrants()` to grant both blinding and freezelist slots.
The wallet must implement the algorithm. Older wallets can use caller-supplied
literal proofs or an existing provider.

Automatic local resolution reads `freeze_list_root[1u8]` once per list per
action. It downloads `/programs/:programID/compliance/freeze-list` when the
current tree is missing, checks each witness against the chain root, and caches
trees and proofs in memory per client, network, list, root and subject. Each
later action checks the root again; unchanged roots reuse cached proofs, changed
roots cause a fresh download. Concurrent subjects share the download. The known
empty root uses a verified empty witness without downloading a tree. Frozen
subjects, missing roots and stale indexer trees fail before execution; errors do
not fall back to empty proofs. A root change during transaction proving may
still require retrying the action. Caches disappear on restart and retain at most
16 lists and 256 subjects per list.

### Optional configuration

Defaults recognize `shield_swap_freezelist.aleo`, credits (no compliance proof),
and the mainnet/testnet USDCx underlying programs. Custom deployments supply a
complete wrapper-to-list map on the client or action. Wrapper and freezelist
program names are distinct:

```ts
const freezelists = {
  ammFreezelistProgram: 'shield_swap_freezelist.aleo',
  wrapperFreezelists: {
    'custom_usdcx_wrapper.aleo': 'usdcx_freezelist.aleo',
    'custom_credits_wrapper.aleo': null,
  },
}
const client = walletClient.extend(shieldSwapActions({ freezelists }))
// Wallet connection: algorithmsAllowed: shieldSwapAlgorithmGrants({ freezelists })
```

Each grant restricts its call site and allowed freezelists.
`shieldSwapFreezelistGrants()` returns only freezelist grants for callers that
compose their own grant set. Unknown wrapper mappings fail before submission.

`proofs` also accepts existing `ProofProvider`/`ProofInputProvider` callbacks,
raw Aleo strings, or `{ freezelistProgram, address, proof }[]` for lookup by subject.
Multiple literal bundles use fixed-length tuples in transaction input order;
the selected route's exact count
is checked before execution. The same literal may fill several slots when the
list and address match.

```ts
await client.swap({ ...swapParams, proofs: cachedSenderProof }) // one wrapped input
await client.mint({ ...plainMintParams, proofs: [signerProof, recipientProof, withdrawalProof] })
await client.collect({ ...collectParams, proofs: null }) // force automatic resolution
```

`shieldSwapActions({ proofs: provider })` sets a client default. Per-call
literals or callbacks override it; `undefined` inherits it and `null` selects
automatic resolution. Caller-supplied proofs bypass automatic freshness checks;
the caller is responsible for their subjects, roots and validity. Local accounts
reject wallet-derived requests returned by providers.

Automatic proofs for `collect` and `rebalancePosition` need the actual withdrawal
address. Granted plaintext supplies it; for an opaque wallet-selected PositionNFT,
pass `withdrawalAddress`. The built-in wallet provider also requires it. If both
plaintext and an explicit address are available, they must match. This parameter
identifies a proof subject and cannot change the payout fixed in the NFT.

Supplied proof tuples and custom providers do not require `withdrawalAddress`.
Custom providers retain the legacy signer fallback in their context when the
withdrawal address is unknown, and own responsibility for selecting the correct
subject. A provider can declare `requiresSubject: true` to reject that fallback;
the built-in wallet provider does so. Annotated proofs can identify a single
withdrawal address distinct from the signer, or reuse the signer when no distinct
address is supplied. Collections naming multiple possible withdrawal addresses
must use an ABI-ordered tuple or a provider instead.

```ts
await client.collect({
  poolKey,
  positionRecord: { type: 'record', program: 'shield_swap.aleo', recordname: 'PositionNFT' },
  withdrawalAddress: positionWithdrawalAddress,
  amount0Requested: 100n,
  amount1Requested: 100n,
})
```

The CLI and agent/MCP write handlers use the SDK default generator. Existing
providers remain compatible, including explicit legacy empty-witness providers
for deployments that accept them. Omission now checks the actual current list.

## Record inventory

The inventory wrappers pass each token's underlying program to core, which
resolves its record and amount field. For more than two records, core prefers
available batch helpers: dedicated credits and stablecoin helpers accept up to
16 records; dynamic ARC helpers accept up to 15. Set
`recordManagement.tokenJoin: false` for native pairwise joins, or supply
`{ program, maxRecords? }` to override the dynamic ARC router.

Reservations and recovery are off by default. Set
`recordManagement: { enabled: true, store, chainId }` when creating the wallet
client, then apply `shieldSwapActions` to prevent maintenance and trading from
spending the same records. Adding `recordActions()` alone leaves these features
disabled. `planInventory({ token, target })` and
`rebalanceInventory({ token, target })` use the DEX token's underlying program
with core's ARC20/ARC22/credits actions. Participating clients MUST share the
same store and chain identity. The SDK has no database dependency.

Follow the [record inventory guide](../../site/docs/guides/record-inventory.md)
for configuration, shared storage, and recovery after an interruption.
