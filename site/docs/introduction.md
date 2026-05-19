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
| `@veil/core` | Clients, actions, transports, types |
| `@veil/wallet-adapter` | Bridges any Aleo wallet adapter into veil |
| `@veil/provable` | Local accounts, signing, and proving via `@provablehq/sdk` |
| `@veil/bridge` | Cross-chain bridge client (Aleo ↔ other) over wallet-services-api |
| `@veil/devnode` | Test client actions for local devnode (fund, reset, mine) |
| `@veil/leo` | Leo CLI wrapper — compile, run, build programs locally |
| `@veil/codegen` | Generate typed contract instances from Aleo programs |
| `@veil/react` | `VeilProvider` + `useVeilWallet()` for React apps |

## Features

- **Public client** — Read blocks, transactions, mappings, balances, programs, committee state, metrics, supply
- **Wallet client** — Execute programs, deploy, sign, transfer, decrypt records, track transaction status
- **Any wallet** — Shield, Leo, Puzzle, Fox, or any adapter implementing the Aleo wallet standard
- **Any SDK** — Use `@provablehq/sdk` for headless/server-side operations with the same interface
- **React** — `VeilProvider` auto-configures all wallets. `useVeilWallet()` returns ready-to-use clients
- **Records** — Fetch, filter, and use private records as program inputs
- **Transaction lifecycle** — Submit, poll status, refresh state on confirmation
