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
| `@veil/core` | Clients (public/wallet/test), actions, transports, types |
| `@veil/wallet-adapter` | Bridges any Aleo wallet adapter into veil |
| `@veil/react` | `VeilProvider` + `useVeilWallet()` for React apps |
| `@veil/provable` | Local accounts (private key + mnemonic), signing, proving, and record scanning via `@provablehq/sdk` |
| `@veil/devnode` | Spawn/control a local `aleo-devnode` and bind a test client to it |
| `@veil/leo` | Programmatic wrapper around the `leo` CLI (build, abi, deploy, synthesize) |

## Features

- **Public client** — Read blocks, transactions, mappings, balances, programs (and editions), committee state, metrics, supply, tokens
- **Wallet client** — `writeContract` (submit), `simulateContract` (dry run), `executeContract` (submit + wait + parse outputs), deploy, sign, transfer, decrypt records, track transaction status
- **Any wallet** — Shield, Leo, Puzzle, Fox, or any adapter implementing the Aleo wallet standard
- **Any SDK** — Use `@provablehq/sdk` (via `@veil/provable`) for headless/server-side operations with the same interface
- **React** — `VeilProvider` auto-configures all wallets. `useVeilWallet()` returns ready-to-use clients
- **Records** — Fetch, filter, and use private records as program inputs
- **Transaction lifecycle** — Submit, poll status (`accepted` / `rejected` / `pending` / `not_found`), refresh state on confirmation
- **Local devnet** — `createDevnodeClient()` returns a fully-wired client pair against `aleo-devnode` (skips ZK proof generation for fast iteration)
