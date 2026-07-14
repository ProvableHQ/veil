# @provablehq/shield-swap-sdk

A viem-shaped TS/JS client for the `shield_swap` AMM on Aleo. The client provides 
viem-style actions for the following:

### Executing DEX smart-contract functions
Actions for executing the functions of the `shield_swap_v3.aleo` contract.
- **Private swaps** — Runs the `swap` --> `claim_swap_output` flows, and the
multi-hop variants (`swap_multi_hop` --> `claim_multi_hop_output`) for 2–3
pool routes.
- **Liquidity** — create pools (via `create_pool`), 
mint concentrated-liquidity positions (`mint`) and add to them (`increase_liquidity`).

### Reading the DEX contract + DEX API
Actions for:
- Reading Shield Swap smart-contract mappings directly — pools, slots,
positions, ticks, swap outputs, and the pause/freeze control gates.
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
  url: 'https://api.provable.com/scanner',
  consumerId: CONSUMER_ID,
  apiKey: DPS_API_KEY, // authenticates + registers the view key for scanning
})

const { walletClient, account } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated',
  proverUrl: 'https://api.provable.com/prove/testnet',
  apiKey: DPS_API_KEY,
  consumerId: CONSUMER_ID,
  records: scanner,
})

const client = walletClient.extend(
  shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }),
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
  shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }),
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
or the service. By default everything targets `shield_swap_v3.aleo` and the
Provable dev API; override either with
`shieldSwapActions({ program, api: { baseUrl } })`.

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

#### Local

The handle already carries `swapId` and `blindedAddress`, so the claim just
works:

```ts
const { amountOut, amountRemaining } = await client.claimSwapOutput({
  handle,
  imports,
})
```

#### Wallet

The wallet filled the blinding slots at request time, so the handle came back
without `swapId`/`blindedAddress`. Recover them from the confirmed request
transaction first — `swapId` is the transition's first public output, and the
blinded address is also readable from `api.getSwap(...).recipient` — set them on
the handle, then claim. The wallet re-derives the blinding factor from the
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

const { amountOut, amountRemaining } = await client.claimSwapOutput({
  handle,
  imports,
})
```

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
whole id preimage, consumed by the claim. Partial fills on later hops refund
the intermediate token; the claim reports those as `hopRefunds` alongside the
main output and input refund:

```ts
const { amountOut, amountRemaining, hopRefunds } = await client.claimMultiHopOutput({
  handle,
  imports,   // include every token program the route touches
})
```

Signer paths, `SwapOutputNotFinalizedError`, and the wallet-path recovery
story all match the single-hop flow (the local helper there is
`deriveMultiHopSwapId`, and unlike the single-hop preimage it includes the
deadline).

## Liquidity

Positions are concentrated-liquidity ranges, held as private records. Both
mint and increase spend token records, so — like [swapping](#request-the-swap)
— they differ by signer: a local key auto-selects records, a wallet supplies
them as `record` InputRequests.

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
  positionRecord: { type: 'record', program: 'shield_swap_v3.aleo', recordname: 'PositionNFT', filters: { pool: { eq: poolKey } } },
  token0Record: { type: 'record', program: token0Program, recordname: 'Token', filters: { amount: { gte: `${amount0Desired}u128` } } },
  token1Record: { type: 'record', program: token1Program, recordname: 'Token', filters: { amount: { gte: `${amount1Desired}u128` } } },
})
```

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
(a frozen position blocks liquidity operations until unfrozen).
`getTokenDecimals` reads a token's registered decimal count, which pairs
with `dustScale` to validate raw amounts. Control state can change before
your transaction finalizes, so treat a green read as advisory.

Two more chain reads round out reconciliation after liquidity operations:
`getPosition` returns a position's public state by its token id (liquidity,
range, and the `tokens_owed` balances that `decreaseLiquidity` and fee
accrual settle into), and `getTick` returns an initialized tick — pass
`{ poolKey, tick }` to derive the key locally, or a pre-derived `tickKey`
to stay off the WASM peer.

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

// Public — the API's public/authorized balances for any address.
await client.api.getPublicBalances({ user: address })

// Combined — public + private + total per token, keyed by token id.
await client.getBalances()
// { '1223…045field': { symbol: 'ETHx', decimals: 18, public: 5n, private: 3n, total: 8n }, … }
```

`getBalances` composes the other two: it pulls the token registry from the API
(so you don't hand it a program list), reads public balances, sums your private
records, and joins them per token. It defaults to your account's address and,
unless you pass a `tokens` filter, returns only tokens you actually hold.

## Bridging in and out

Value can enter and leave Aleo around a DEX position via `@provablehq/veil-aleo-bridges` —
both packages hang off the same `@provablehq/veil-core` wallet client, so one signer
covers the whole chain: bridge assets in, trade them privately here, bridge
the proceeds out.

```ts
import { createBridgeClient, httpBridge } from '@provablehq/veil-aleo-bridges'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
  wallet: walletClient,
})
const dex = walletClient.extend(shieldSwapActions({ api: {} }))

// Discover a bridge route by symbol and chain name, then bridge out in one
// call — the deposit is signed by the same wallet that traded. Pin both
// sides to the native assets: outbound routes exist only for native ALEO.
const routes = await bridge.getRoutes({ symbol: 'SOL', externalChain: 'Solana' })
const route = routes.find((r) => r.aleoAsset.native && r.externalAsset.native)!
await bridge.swap({
  from: { asset: route.aleoAsset.code, amount: '100' },
  to: { chain: route.externalAsset.chainName, asset: route.externalAsset.code, address: solAddress },
  poll: true,
})
```

Bridging in starts on the source chain (its wallet signs the deposit), so
from this SDK you quote and create the order, then pay the instructions from
that chain's wallet. The full walkthrough — including the EVM deposit via
viem — lives in the
[`@provablehq/veil-aleo-bridges` README](../bridge/README.md#swapping-bridged-assets-on-shield-swap),
and the whole chain is exercised by
[`bridgeRoundTrip.e2e.test.ts`](./test/integration/bridgeRoundTrip.e2e.test.ts).

One seam to know: the bridge operates on mainnet while `shield_swap` is on
testnet today, so the two legs run on different networks until the DEX lands
on mainnet.

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
The write tier additionally needs a funded testnet account and delegated-proving
credentials, because it broadcasts real transactions and pays fees:

```sh
VEIL_INTEGRATION=1          # enables every integration test
VEIL_E2E_PRIVATE_KEY=...    # funded testnet account — write tier only (pays fees)
ALEO_DPS_API_KEY=...        # delegated proving — write tier only
ALEO_CONSUMER_ID=...        # delegated proving + record scanning — write tier only
```

| File | Tier | What it exercises |
| --- | --- | --- |
| [`traders.integration.test.ts`](./test/integration/traders.integration.test.ts) | read-only | The analyses a trader runs before trading — spot price, price impact and output size from live liquidity, route quoting with slippage sizing, in-range LP position selection, and fee-APR from OHLCV volume. Asserts math invariants, not exact live figures. |
| [`reads.integration.test.ts`](./test/integration/reads.integration.test.ts) | read-only | Chain-direct reads (pools, slots, fee tiers, validation) against live state. |
| [`api.integration.test.ts`](./test/integration/api.integration.test.ts) | read-only | The off-chain `ApiClient` — pools, tokens, routes, balances, OHLCV. |
| [`balances.integration.test.ts`](./test/integration/balances.integration.test.ts) | write | The composed balance view — public balances from the API joined with private balances decoded from the account's records. Needs the account because private balances live in its records. |
| [`poolCreation.integration.test.ts`](./test/integration/poolCreation.integration.test.ts) | write | Creates a pool on testnet: finds a token pair and a registered fee tier, calls `createPool`, then polls `isPoolInitialized` until the finalize propagates. If the pair already has a pool at every tier tried, it confirms the contract rejects the duplicate instead. |
| [`e2e.test.ts`](./test/integration/e2e.test.ts) | write | The full private-swap lifecycle — airdrop, privatize records, ensure a pool, `swap`, read the output, `claimSwapOutput`. |
| [`bridgeRoundTrip.e2e.test.ts`](./test/integration/bridgeRoundTrip.e2e.test.ts) | write | The cross-product chain with `@provablehq/veil-aleo-bridges`: verify the inbound bridge route, swap on the DEX, bridge the proceeds out. Additionally gated by `VEIL_BRIDGE_E2E=1` — the bridge leg spends mainnet ALEO. |

Run one file, or a set:

```sh
# Read-only tier — no account needed
VEIL_INTEGRATION=1 pnpm exec vitest run packages/shield-swap/test/integration/traders.integration.test.ts

# Write tier — needs the funded account + proving credentials above
VEIL_INTEGRATION=1 pnpm exec vitest run packages/shield-swap/test/integration/poolCreation.integration.test.ts

# The whole integration suite
VEIL_INTEGRATION=1 pnpm exec vitest run packages/shield-swap/test/integration
```

A test that reports as skipped is missing a required variable for its tier. The
write tier spends real testnet funds on each run. Optional overrides:
`VEIL_DEX_PROGRAM` (defaults to `shield_swap_v3.aleo`), `ALEO_DPS_URL`, and
`ALEO_RSS_URL`.
