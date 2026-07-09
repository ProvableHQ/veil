---
sidebar_position: 6
---

# @provablehq/shield-swap-sdk

A viem-shaped client for the `shield_swap` concentrated-liquidity AMM on Aleo:
private swaps, liquidity management, direct on-chain reads, and a typed off-chain
DEX API — all composed onto one client via `extend()`. Works with either signer
path: a local private key (bots, scripts) or a connected wallet (Shield, Leo).

```bash
npm install @provablehq/veil-core @provablehq/shield-swap-sdk
```

## Key exports

- **`shieldSwapActions(config)`** — the decorator; chain reads/writes sit flat on the client, the DEX API under `.api`.
- **Swaps** — `swap` → `claimSwapOutput` (+ `SwapHandle`).
- **Liquidity** — `createPool`, `mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect`, `burn`.
- **Reads** — `getPool`, `getSlot`, `getSwapOutput`; balances `getBalances`, `getPrivateBalances`.
- **Wallet grants** — `SHIELD_SWAP_ALGORITHM_GRANTS`, `shieldSwapAlgorithmGrants`.

## Usage

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = walletClient.extend(
  shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }),
)

const pools = await client.api.getPools()          // off-chain API
const pool = await client.getPool({ poolKey: pools.data[0].key }) // chain read
```

## Subpaths

- **`@provablehq/shield-swap-sdk/agent`** — `createShieldSwapAgentTools({ client, api, includeWrites? })` and `shieldSwapAgentToolSchemas()`. Read tools by default; money-moving write tools are opt-in via `includeWrites`.
- **`@provablehq/shield-swap-sdk/mcp`** — `createShieldSwapMcpServer({ client, api })`.

The package ships a thorough
[README](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap/README.md)
covering both signer setups, program imports, swapping, liquidity, and codegen.
