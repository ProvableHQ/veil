---
sidebar_position: 1
---

# Introduction

Veil is a TypeScript interface for Aleo. If you've used [viem](https://viem.sh) for Ethereum, you already know how to use Veil.

## Why Veil?

Aleo's developer tooling is fragmented. Every dApp writes bespoke glue code against raw SDKs, every wallet has a different API, and agents can't interact with the chain at all. Veil fixes this by providing a single interface that works across every wallet and SDK.

```ts
// Read chain state — no wallet needed
const balance = await publicClient.getBalance({ address: 'aleo1...' })

// Execute a program function — any wallet
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
})
```

## Packages

| Package | Description |
|---|---|
| [`@provablehq/veil-core`](./packages/core) | Clients, actions, transports, types — plus `/agent` + `/mcp` bindings |
| [`@provablehq/veil-aleo-sdk`](./packages/provable-sdk) | Local accounts, signing, and proving via `@provablehq/sdk` |
| [`@provablehq/veil-aleo-wallet-adapter`](./packages/wallet-adapter) | Bridges any Aleo wallet adapter into veil |
| [`@provablehq/veil-aleo-react-hooks`](./packages/react) | `VeilProvider` + `useVeilWallet()` for React apps |
| [`@provablehq/shield-swap-sdk`](./packages/shield-swap) | Client for the `shield_swap` AMM/DEX |
| [`@provablehq/veil-codegen`](./packages/codegen) | Typed bindings from an Aleo program ABI |
| [`@provablehq/veil-aleo-devnode`](./packages/devnode) | Run and drive a local Aleo devnode |
| [`@provablehq/veil-leo`](./packages/leo) | Typed wrapper around the `leo` CLI |
| [`@provablehq/veil-aleo-bridges`](./packages/bridge) | Cross-chain bridge client (preview) |

See [Packages](./packages/overview) for the full breakdown.

## Features

- **Public client** — Read blocks, transactions, mappings, balances, programs, committee state, metrics, supply
- **Wallet client** — Execute programs, deploy, sign, transfer, decrypt records, track transaction status
- **Any wallet** — Shield, Leo, Puzzle, Fox, or any adapter implementing the Aleo wallet standard
- **Any SDK** — Use `@provablehq/sdk` for headless/server-side operations with the same interface
- **React** — `VeilProvider` auto-configures all wallets. `useVeilWallet()` returns ready-to-use clients
- **Records** — Fetch, filter, and use private records as program inputs
- **Transaction lifecycle** — Submit, poll status, refresh state on confirmation
