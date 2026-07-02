# @veil/dex

TS/JS client based on veil for the `shield_swap` AMM on Aleo. 

This client provides the following functionality for

* **Executing DEX functions:** Functions that map 1:1 with the shield_swap contract
executing private swaps, pool creation,
reads of the 
concentrated liquidity positions, reads of on-chain pool state, and a typed
client for the indexer's REST API.

## Installation

```sh
pnpm add @veil/dex @veil/core
```

If you sign with a local private key (bots, scripts, tests) you also need
`@provablehq/sdk`. It is used to derive the blinded identity that private
swaps are claimed with. If your app connects to a wallet instead, the wallet
does that derivation itself and you can skip the dependency.

## What you need to configure

Reading pool state and querying the indexer needs nothing beyond a transport.
To send transactions you need:

- an account with testnet credits to pay fees
- proving, either delegated (an API key and consumer id for the Provable
  proving service) or local
- a record scanner, because swaps and mints spend private records and the
  client has to be able to find yours

If you build against a wallet like Shield, the wallet takes care of all three.
See [Wallet accounts](#wallet-accounts) below.

## Setup

```ts
import { loadNetwork } from '@veil/provable'
import { dexActions } from '@veil/dex'

const aleo = await loadNetwork('testnet')

const scanner = aleo.createRemoteScanner({
  url: 'https://api.provable.com/scanner',
  consumerId: CONSUMER_ID,
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

const client = walletClient.extend(dexActions({ indexer: {} }))
```

`dexActions` adds the DEX methods to the client. On-chain reads and writes go
directly on the client, and the indexer client is available at
`client.indexer`. By default everything targets the live deployment
(`shield_swap_v0_0_1.aleo`) and the Provable dev indexer; override either
with `dexActions({ program, indexer: { baseUrl } })`.

## Pools and tokens

Pool discovery goes through the indexer. Each pool entry has the pool key
(every read and swap takes it) plus metadata for both tokens:

```ts
const pools = await client.indexer.getPools()
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

## Program imports

`shield_swap` calls token programs through a dynamic dispatch interface, so
the prover can't discover the token programs by static analysis. Every write
takes an `imports` map of program id to program source for the tokens
involved. Fetch the sources once and reuse them:

```ts
import { getProgram } from '@veil/core'

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

Request the swap:

```ts
const route = await client.indexer.getRoute({
  token_in: tokenIn,
  token_out: tokenOut,
  amount_in: amountIn,
})

const handle = await client.swapPrivate({
  poolKey,
  tokenInId: tokenIn,
  amountIn,                                   // raw atomic amount, bigint
  expectedOut: BigInt(route.data.amount_out),
  slippageBps: 50,                            // 0.5%
  tokenInProgram,                             // the token's wrapper program
  imports,
})
```

The indexer quote feeds the slippage check: the swap reverts on chain if the
output falls more than `slippageBps` below `expectedOut`. If you omit
`expectedOut` a spot-price estimate is used, which ignores fees and price
impact, so pass a real quote for anything beyond a tiny trade.

`swapPrivate` returns a plain serializable handle, and the handle is the key
to claiming your output. Persist it if there is any chance your process dies
before the claim.

Claim the output:

```ts
const { amountOut, amountRemaining } = await client.claimSwapOutputPrivate({
  handle,
  imports,
})
```

If this throws `SwapOutputNotFinalizedError`, the request transaction hasn't
finalized yet; retry after a few blocks. The same error after a successful
claim means the output was already collected, since claiming consumes the
on-chain entry.

On the local-key path the client handles the private plumbing for you: it
picks an unspent token record that covers the amount and derives a fresh
single-use claim identity from your view key.

## Liquidity

Positions are concentrated-liquidity ranges, held as private records. To mint
one, pick a tick range around the current price. Ticks get rounded to the
pool's tick spacing automatically:

```ts
const slot = await client.getSlot({ poolKey })

const { positionTokenId } = await client.mintPrivate({
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

The tick range is fixed at mint. To add funds to an existing position:

```ts
await client.increaseLiquidityPrivate({
  poolKey,
  amount0Desired,
  amount1Desired,
  imports,
})
```

Creating a new pool is a single public transaction. The fee tier must be one
the program has registered (it is validated before submission), and the tick
spacing is derived from it:

```ts
const { poolKey } = await client.createPool({
  token0ProgramId,
  token1ProgramId,
  fee: 3000,       // in pips: 0.30%
  initialTick: 0,  // sets the opening price
})
```

## Balances

`getOwnBalances` sums your unspent records per token, so it reflects what you
can actually spend privately. The indexer's `getBalances` reports public
balances for any address:

```ts
await client.getOwnBalances({ programs: [token0Program, token1Program] })
// { 'ethx_5a095e.aleo': 3000000000000000000n }

await client.indexer.getBalances({ user: address })
```

## Wallet accounts

When your app is connected to a wallet, the dapp never sees keys or records,
so two things change:

1. Pass `SHIELD_SWAP_ALGORITHM_GRANTS` in the wallet connect options. This
   allows the wallet to derive the claim identity for private swaps on your
   behalf.
2. Provide record inputs explicitly as `record` InputRequests instead of
   relying on auto-selection: `tokenRecord` on `swapPrivate`, `token0Record`
   and `token1Record` on `mintPrivate`. The wallet resolves them against its
   own records.

Parameters and return shapes are otherwise identical. The wallet proves the
transaction, so the client needs no proving configuration and no scanner.

## Units and formats

- Token amounts are raw atomic units, typed `bigint`. Ticks and fees fit in
  `number`.
- Fees are in pips (`3000` = 0.30%). Slippage is in basis points (`50` = 0.5%).
- Pool keys and token ids are Aleo field literals including the suffix, e.g.
  `'4719...field'`.
- Fields read from chain keep their wire names (`amount_out`, `tick_spacing`).

## Reference

The integration test at
[`test/integration/e2e.test.ts`](./test/integration/e2e.test.ts) runs the full
lifecycle against the real testnet (airdrop, privatize records, create pool,
mint, swap, claim) and is the most complete usage example in the repo.
