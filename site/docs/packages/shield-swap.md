---
sidebar_position: 6
---

# @provablehq/shield-swap-sdk

A viem-shaped client for `shield_swap_v3.aleo`, the concentrated-liquidity AMM
on Aleo: private swaps, liquidity management, direct on-chain reads, and a
typed off-chain DEX API — all composed onto one client via `extend()`. It
works with either signer path: a local private key (bots, scripts) or a
connected wallet (Shield, Leo).

## Installation

```bash
npm install @provablehq/veil-core @provablehq/shield-swap-sdk
```

## Client pairings

The signer determines which `@provablehq/veil-core` client
`shieldSwapActions` extends. In a frontend, pair it with
`@provablehq/veil-aleo-react-hooks`, where the connected wallet signs and
proves. In an agent trader or programmatic bot, pair it with
`@provablehq/veil-aleo-sdk` for a local key, local or delegated proving.
Read-only pool and price queries need only a `PublicClient` over a transport —
no key, proving, or record scanner.

## Key exports

- **`shieldSwapActions(config)`** — the `extend()` decorator; chain reads/writes sit flat on the client, the DEX API sits under `.api`.
- **Swaps** — `swap` → `claimSwapOutput` (the two-phase private swap: request, then claim once the chain computes the output), plus the intermediate `SwapHandle`.
- **Liquidity** — `createPool`, `mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect`, `burn`.
- **Reads** — `getPool`, `getSlot`, `getSwapOutput`; combined balances via `getBalances` and `getPrivateBalances`.
- **Wallet grants** — `SHIELD_SWAP_ALGORITHM_GRANTS`, `shieldSwapAlgorithmGrants` — the connect-time algorithm allowlist a wallet-signer setup passes to `VeilProvider`'s `algorithmsAllowed`.

## Example

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = walletClient.extend(
  shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }),
)

const pools = await client.api.getPools()                          // off-chain API
const pool = await client.getPool({ poolKey: pools.data[0].key })  // chain read
```

## Subpaths

- **`@provablehq/shield-swap-sdk/agent`** — `createShieldSwapAgentTools({ client, api, includeWrites? })` and `shieldSwapAgentToolSchemas()`. Read tools are included by default; money-moving write tools are opt-in via `includeWrites`.
- **`@provablehq/shield-swap-sdk/mcp`** — `createShieldSwapMcpServer({ client, api })`.

See the [`/api/shield-swap`](/api/shield-swap/swap) pages for individual
action parameters and returns. The package README covers both signer setups,
program imports, and codegen in full:
[README](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap/README.md).
