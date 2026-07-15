---
sidebar_position: 8
---

# Integrating Shield Swap

Shield Swap is the concentrated-liquidity AMM on Aleo, deployed as
`shield_swap_v3.aleo`. Trading on it differs from trading on an EVM DEX in
one structural way: swaps are private, so a swap is two transactions rather
than one. The first submits the request; when it finalizes, the chain
computes the actual output and stores it in a mapping under a swap id. The
second transaction claims that output, which lands in the trader's account
as private records — Aleo's encrypted spendable notes, analogous to UTXOs.
Until the claim runs, the output is not spendable.

`@provablehq/shield-swap-sdk` wraps this lifecycle in typed methods on a
Veil client and handles the parts that are easy to get wrong: deriving the
single-use blinded identity a private swap is claimed with, selecting the
records a swap spends, and sequencing the two-phase claim. This guide walks
the full integration with a local private key — the setup for a bot, script,
or server — and notes where the connected-wallet path differs. Each step
links to the corresponding [`/api/shield-swap`](/api/shield-swap/swap)
reference page for complete parameters, return shapes, and errors.

## Set up a client

Chain reads need only a transport. Writes need three more things: an account
that can sign, a proving configuration (delegated below, or fully local),
and a record scanner so the client can find the unspent private records that
swaps and mints spend.

[`createAleoClient`](/api/provable-sdk/createAleoClient) wires all of that
in one call — it derives the account from the private key, builds the
transport, and constructs the proving config internally. Extending the
result with `shieldSwapActions` adds the DEX methods.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const aleo = await loadNetwork('testnet')

const scanner = aleo.createRemoteScanner({
  url: 'https://api.provable.com/scanner',
  consumerId: CONSUMER_ID,
  apiKey: DPS_API_KEY,
})

const { walletClient } = aleo.createAleoClient({
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

Delegated proving and the hosted scanner authenticate with a consumer id and
API key issued by the Provable API; registration is a one-time step against
the Provable API's registration and JWT-issuance endpoints. See
[`createRemoteScanner`](/api/provable-sdk/createRemoteScanner) for the
scanner's registration behavior.

The composed client has two surfaces, split by provenance. Chain-direct
reads and writes sit flat on the client (`client.getPool`, `client.swap`) —
these values come from the node and gate money movement. The off-chain DEX
API is namespaced under `client.api` (`client.api.getPools`), so a call site
always shows which world a value came from. Both default to
`shield_swap_v3.aleo` and the Provable API; override either with
`shieldSwapActions({ program, api: { baseUrl } })`.

In a browser dApp, the connected wallet replaces all of this configuration:
it holds the keys and records and proves on the user's behalf, so the app
carries no private key, proving config, or scanner. Build the client from
the wallet adapter's account and transport instead — the wallet-account
examples on [`swap`](/api/shield-swap/swap) show the connect-time setup,
including the `SHIELD_SWAP_ALGORITHM_GRANTS` the wallet needs to derive
blinded identities.

## Authenticating with the DEX API

Most DEX API endpoints beyond pool and token discovery — routes, swaps,
positions, balances, fee tiers, candles — require a bearer credential. The
account signs a challenge once per session:

```ts
await client.authenticateApi()
const route = await client.api.getRoute({ token_in, token_out })
```

The session lasts about 24 hours and renews itself: the signer is retained,
so an expired session re-authenticates and retries on the next gated call.

A process that should not sign on every boot — a bot, CI, a server — mints a
long-lived API token (`ss_…`) once and passes it at construction instead:

```ts
// One-time provisioning; the secret is shown only once.
await client.authenticateApi()
const { token } = await client.api.createApiToken({ name: 'trading-bot' })

// Every run after that — no handshake, no signer needed for API reads.
const bot = walletClient.extend(shieldSwapActions({ api: { apiToken: token } }))
```

Managing tokens (`createApiToken`, `listApiTokens`, `revokeApiToken`) always
requires a fresh session JWT; the tokens themselves cover data and trading
endpoints only.

Authentication is the first of two gates. The account must also have
redeemed an invite code, or gated endpoints return 403
`redeem an invite code to unlock access`:

```ts
await client.authenticateApi()
if (!(await client.api.getAccessStatus()).has_access) {
  await client.api.redeemAccessCode(inviteCode) // one-time per account
}
```

Redemption unlocks the session immediately — the client adopts the upgraded
token the server returns, no second handshake needed.

## Pools and tokens

Pool discovery goes through the DEX API. Each entry carries the pool key —
an Aleo field literal that every read and swap takes — plus metadata for
both tokens.

```ts
const { data: pools } = await client.api.getPools()
const pool = pools[0]

pool.key                          // '4719…field'
pool.token0                       // token id, a field literal
pool.token0_info.decimals
pool.token0_info.wrapper_program  // e.g. 'ethx_5a095e.aleo'
```

The `wrapper_program` matters: private token balances live as records inside
each token's wrapper program, so the swap and mint calls need to know which
program to look in.

On-chain state comes in two parts. [`getPool`](/api/shield-swap/getPool)
returns static configuration — token pair, fee tier, decimal scales — and
[`getSlot`](/api/shield-swap/getSlot) returns live trading state: the
current sqrt price, active tick, and in-range liquidity.

```ts
const config = await client.getPool({ poolKey: pool.key })
const slot = await client.getSlot({ poolKey: pool.key })
```

## Program imports

`shield_swap` calls token programs through a dynamic dispatch interface, so
the prover cannot discover them by static analysis. Every write takes an
`imports` map of program id to program source for the tokens involved. Fetch
the sources once and reuse them across calls:

```ts
import { getProgram } from '@provablehq/veil-core'

const imports = {
  [pool.token0_info.wrapper_program]: await getProgram(walletClient, { programId: pool.token0_info.wrapper_program }),
  [pool.token1_info.wrapper_program]: await getProgram(walletClient, { programId: pool.token1_info.wrapper_program }),
}
```

## Quote, then swap

Quote the trade first — the quote feeds the on-chain slippage check: the
swap reverts if the output falls more than `slippageBps` below
`expectedOut`. Omitting `expectedOut` falls back to a spot-price estimate,
which ignores fees and price impact, so pass a real quote for anything
beyond a tiny trade.

The API's route estimate is a display decimal in the output token's units;
`expectedOut` wants raw base units (u128), so scale by the token's decimals:

```ts
const amountIn = 1_000_000n
const route = await client.api.getRoute({
  token_in: pool.token0,
  token_out: pool.token1,
  amount_in: amountIn,
})
const expectedOut = BigInt(
  Math.floor(Number(route.data.estimated_amount_out ?? 0) * 10 ** pool.token1_info.decimals),
)
```

[`swap`](/api/shield-swap/swap) submits the request — phase one. On the
local-signer path the client auto-selects an unspent record covering
`amountIn` from the token's wrapper program and derives the single-use claim
identity from the account's view key. It returns a `SwapHandle`, a plain
serializable object that is the key to claiming the output. Persist it if
there is any chance the process dies before the claim.

```ts
const handle = await client.swap({
  poolKey: pool.key,
  tokenInId: pool.token0,
  amountIn,               // raw atomic amount, bigint
  expectedOut,            // scaled to base units above
  slippageBps: 50,        // 0.5%
  tokenInProgram: pool.token0_info.wrapper_program,
  imports,
})
```

A wallet never exposes its records, so the wallet path drops
`tokenInProgram` and passes `tokenRecord` as a `record` `InputRequest`
instead — the wallet resolves it against its own records and fills the
blinding slots itself. The handle then comes back without `swapId` or
`blindedAddress`; the wallet-account section of
[`swap`](/api/shield-swap/swap) shows the exact shape.

## Claim the output

Claiming — phase two — reads the chain-computed output from the
`swap_outputs` mapping and collects it as private records.
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput) throws
`SwapOutputNotFinalizedError` when the request transaction has not finalized
yet; retry after a few blocks. The same error after a successful claim means
the output was already collected — claiming consumes the on-chain entry.

```ts
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'

let claimed
for (let i = 0; i < 20; i++) {
  try {
    claimed = await client.claimSwapOutput({ handle, imports })
    break
  } catch (err) {
    if (!(err instanceof SwapOutputNotFinalizedError)) throw err
    await new Promise((r) => setTimeout(r, 3_000))
  }
}

console.log(`received ${claimed!.amountOut}, refunded ${claimed!.amountRemaining}`)
```

Claims are mandatory: a swap's tokens are not the trader's until claimed.
`amountRemaining` is non-zero when the swap partially filled at the price
limit — the unspent input comes back in the same claim. To inspect the
chain-computed result without claiming, read it directly with
[`getSwapOutput`](/api/shield-swap/getSwapOutput).

On the wallet path the handle needs `swapId` and `blindedAddress` set before
claiming — recover them from the confirmed request transaction (the swap id
is the transition's first public output; the blinded address is also
readable from `api.getSwap(...).recipient`). The wallet re-derives the
blinding factor from the blinded address, so the dApp never holds it. See
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput) for the full recovery
flow.

## Liquidity

Positions are concentrated-liquidity ranges, held as private records.
[`createPool`](/api/shield-swap/createPool) opens a pair at a fee tier —
a single public transaction, identical on both signer paths.
[`mint`](/api/shield-swap/mint) opens a position over a tick range; ticks
round to the pool's tick spacing automatically, and the range is fixed at
mint. Mint and [`increaseLiquidity`](/api/shield-swap/increaseLiquidity)
both spend token records, so they split by signer the same way `swap` does:
a local key auto-selects records, a wallet supplies them as `record`
`InputRequest`s.

```ts
const slot = await client.getSlot({ poolKey: pool.key })

const { positionTokenId } = await client.mint({
  poolKey: pool.key,
  tickLower: slot.tick - slot.tick_spacing * 10,
  tickUpper: slot.tick + slot.tick_spacing * 10,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  token0Program: pool.token0_info.wrapper_program,
  token1Program: pool.token1_info.wrapper_program,
  imports,
})
```

Unwinding a position runs in three steps:
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity) burns liquidity
and accrues the withdrawn amounts as owed;
[`collect`](/api/shield-swap/collect) sweeps owed tokens back as private
records; [`burn`](/api/shield-swap/burn) closes the emptied position. Each
mirrors the funding entry points' local-versus-wallet split.

## Read-only access

Pool state and DEX API queries need neither a key nor proving nor a scanner
— a `PublicClient` over a transport is enough. This is the setup for price
feeds, dashboards, and any consumer that only reads.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
}).extend(shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }))

const pool = await client.getPool({ poolKey })  // static config: token pair, fee, decimals
const slot = await client.getSlot({ poolKey })  // live state: price, tick, liquidity
```

## Balances

Private balances are not an account field on chain — they are the sum of the
caller's unspent records, which only the caller's view key can decrypt. The
SDK offers three views:

```ts
// Private — summed from the caller's unspent records (spendable privately).
await client.getPrivateBalances({ programs: ['ethx_5a095e.aleo'] })
// { 'ethx_5a095e.aleo': 3000000000000000000n }

// Public — the API's public/authorized balances for any address.
await client.api.getPublicBalances({ user: address })

// Combined — public + private + total per token, keyed by token id.
await client.getBalances()
// { '1223…045field': { symbol: 'ETHx', decimals: 18, public: 5n, private: 3n, total: 8n }, … }
```

`getBalances` composes the other two: it pulls the token registry from the
API (so no program list is needed), reads public balances, sums the caller's
private records, and joins them per token. It defaults to the client's own
account address and, unless given a `tokens` filter, returns only tokens the
account actually holds.

## Units and formats

- Token amounts are raw atomic units, typed `bigint` (u128). Ticks and fees
  fit in `number`.
- Fees are in pips (`3000` = 0.30%). Slippage is in basis points
  (`50` = 0.5%).
- Pool keys and token ids are Aleo field literals including the suffix,
  e.g. `'4719…field'`.
- Fields read from chain keep their wire names (`amount_out`,
  `tick_spacing`).

The [`/api/shield-swap`](/api/shield-swap/swap) reference pages document
every action's parameters, return shape, and errors, with both signer paths
per action; the [package page](/packages/shield-swap) covers installation
and the agent/MCP subpaths.
