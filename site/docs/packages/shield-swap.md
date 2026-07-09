---
sidebar_position: 6
---

# @provablehq/shield-swap-sdk

`@provablehq/shield-swap-sdk` is a viem-shaped client for `shield_swap_v3.aleo`, the
concentrated-liquidity AMM on Aleo. It adds typed swap, liquidity, and read
methods to a Veil client via `extend()`, and pairs with either signer path: a
local private key (bots, scripts, CI) or a connected wallet (Shield, Leo). The
signer determines which `@provablehq/veil-core` client `shieldSwapActions`
extends — a local key pairs with `@provablehq/veil-aleo-sdk`; a browser dApp
pairs with `@provablehq/veil-aleo-react-hooks` and lets the connected wallet
sign and prove.

## Install

```bash
npm install @provablehq/veil-core @provablehq/shield-swap-sdk
```

Signing with a local private key also needs `@provablehq/sdk` as a peer — it
derives the blinded identity a private swap is claimed with. A connected
wallet performs that derivation itself, so the dependency is not needed on
the wallet path.

## Set up a client

Chain reads (`getPool`, `getSlot`) need only a transport — no key, proving,
or scanner. Writes (`swap`, `mint`, and the rest) need an account that can
sign, and a record scanner so the client can find the private records those
calls spend.

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

`createAleoClient` wires the account, transport, and proving config for the
caller in one call — see [`createAleoClient`](/api/provable-sdk/createAleoClient).
Delegated proving and the hosted scanner authenticate with a consumer id and
API key issued by the Provable API; registration is a one-time step against
the Provable API's registration and JWT-issuance endpoints.

`shieldSwapActions` adds chain reads and writes flat on the client
(`client.getPool`, `client.swap`) and namespaces the off-chain DEX API under
`client.api` (`client.api.getPools`), so a call site always shows which world
a value came from. Both default to `shield_swap_v3.aleo` and the Provable
API; override either with `shieldSwapActions({ program, api: { baseUrl } })`.

## Quote, swap, and claim

A private swap is two transactions. The first submits the request; when it
finalizes, the chain computes the actual output and stores it in a mapping.
The second claims that output, which arrives as private records. `swap`
sequences the request and returns a handle; `claimSwapOutput` finishes it.

```ts
import { getProgram } from '@provablehq/veil-core'

// Pool discovery goes through the API — each entry carries the pool key
// every read and swap takes, plus token metadata.
const { data: pools } = await client.api.getPools()
const pool = pools[0]
const tokenIn = pool.token0
const tokenOut = pool.token1

// shield_swap dispatches into token programs dynamically, so the prover
// cannot discover them by static analysis — fetch their sources once.
const imports = {
  [pool.token0_info.wrapper_program]: await getProgram(walletClient, { programId: pool.token0_info.wrapper_program }),
  [pool.token1_info.wrapper_program]: await getProgram(walletClient, { programId: pool.token1_info.wrapper_program }),
}

// Quote first — expectedOut feeds the on-chain slippage check. Without it a
// spot estimate is used, which ignores fees and price impact.
const amountIn = 1_000_000n
const route = await client.api.getRoute({ token_in: tokenIn, token_out: tokenOut, amount_in: amountIn })
const expectedOut = BigInt(
  Math.floor(Number(route.data.estimated_amount_out ?? 0) * 10 ** pool.token1_info.decimals),
)

// Phase 1 — request the swap. Persist the handle if the process might die
// before the claim; it is plain JSON.
const handle = await client.swap({
  poolKey: pool.key,
  tokenInId: tokenIn,
  amountIn,
  expectedOut,
  slippageBps: 50, // 0.5%
  tokenInProgram: pool.token0_info.wrapper_program,
  imports,
})

// Phase 2 — claim. SwapOutputNotFinalizedError means the request transaction
// has not finalized yet; retry after a few blocks.
const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle, imports })
```

A wallet never exposes its records, so the wallet path drops `tokenInProgram`
and supplies `tokenRecord` as a `record` `InputRequest` instead; the returned
handle then comes back without `swapId` or `blindedAddress`, recoverable
from the confirmed transaction before claiming. See
[`swap`](/api/shield-swap/swap) and
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput) for both signer paths
in full, and [`getSwapOutput`](/api/shield-swap/getSwapOutput) for reading
the chain-computed result directly.

## Liquidity

Positions are concentrated-liquidity ranges held as private records.
`createPool` opens a pair at a fee tier; `mint` opens a position over a tick
range; `increaseLiquidity`, `decreaseLiquidity`, `collect`, and `burn`
manage it afterward. Mint and increase spend token records, so they split by
signer the same way `swap` does — a local key auto-selects records, a wallet
supplies them as `record` `InputRequest`s.

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

See [`createPool`](/api/shield-swap/createPool),
[`mint`](/api/shield-swap/mint),
[`increaseLiquidity`](/api/shield-swap/increaseLiquidity),
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity),
[`collect`](/api/shield-swap/collect), and
[`burn`](/api/shield-swap/burn) for parameters and both signer paths.

## Read-only access

Pool state and DEX API queries need only a `PublicClient` over a transport —
no key, proving, or scanner:

```ts
import { createPublicClient, http } from '@provablehq/veil-core'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
}).extend(shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }))

const pool = await client.getPool({ poolKey })  // static config: token pair, fee, decimals
const slot = await client.getSlot({ poolKey })  // live state: price, tick, liquidity
```

See [`getPool`](/api/shield-swap/getPool) and [`getSlot`](/api/shield-swap/getSlot)
for the full return shapes.

## Balances

`getBalances` composes the DEX API's public balances with the caller's
private records into one per-token view (`{ symbol, decimals, public,
private, total }`); `getPrivateBalances` reports only the private side, summed
from unspent records for a given set of token programs.

## Subpaths

- **`@provablehq/shield-swap-sdk/agent`** — `createShieldSwapAgentTools({ client, api, includeWrites? })` and `shieldSwapAgentToolSchemas()`. Read tools are included by default; money-moving write tools are opt-in via `includeWrites`.
- **`@provablehq/shield-swap-sdk/mcp`** — `createShieldSwapMcpServer({ client, api })`.

## Reference

Every action's parameters, return shape, and errors are documented under
[`/api/shield-swap`](/api/shield-swap/swap):
[`swap`](/api/shield-swap/swap),
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput),
[`createPool`](/api/shield-swap/createPool),
[`mint`](/api/shield-swap/mint),
[`increaseLiquidity`](/api/shield-swap/increaseLiquidity),
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity),
[`collect`](/api/shield-swap/collect),
[`burn`](/api/shield-swap/burn),
[`getPool`](/api/shield-swap/getPool),
[`getSlot`](/api/shield-swap/getSlot), and
[`getSwapOutput`](/api/shield-swap/getSwapOutput). The package README covers
program imports and codegen in full:
[README](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap/README.md).
