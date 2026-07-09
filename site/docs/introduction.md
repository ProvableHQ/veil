---
sidebar_position: 1
---

# Introduction

Veil is a TypeScript interface for Aleo, modeled on [viem](https://viem.sh).
It gives a public client for reading chain state and a wallet client for
signing and executing programs, with the same method names and shapes viem
uses for Ethereum. A developer who has used viem already knows the shape of
every call in Veil — `getBalance`, `readContract`, `writeContract`,
`deployContract` — before reading a line of Aleo-specific documentation.

## Why Veil exists

Aleo's tooling grew up fragmented. Every wallet — Shield, Leo, Puzzle, Fox —
exposes a different connect and sign API. `@provablehq/sdk` gives direct key
holders a different surface again, built around WASM primitives rather than
client actions. A dApp that wants to support more than one wallet ends up
writing its own adapter layer; an agent that wants to call Aleo has no common
tool surface to call at all. Veil collapses this into one interface: the same
public and wallet client work whether the account behind them is a connected
browser wallet or a local private key, and the same actions back both a
human-readable TypeScript API and a set of MCP/agent tool schemas.

```ts
import { createPublicClient, createWalletClient, fallback, http } from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'

// Read chain state — no wallet needed.
const publicClient = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})
const balance = await publicClient.getBalance({ address: 'aleo1...' })

// Execute a program function — any connected wallet behind the same call.
const { account, transport } = fromWalletAdapter(connectedAdapter)
const walletClient = createWalletClient({
  account,
  transport: fallback([transport, http('https://api.provable.com/v2', { network: 'mainnet' })]),
})
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
})
```

Aleo differs from Ethereum in ways viem's shape does not have to hide.
Programs are called by name (`credits.aleo`), not by address; private state
lives in records rather than storage slots, and `writeContract` returns as
soon as a transaction is broadcast rather than once it settles — Aleo's
transaction lifecycle runs through `pending`, `accepted`, `rejected`, and
`not_found`, checked with `transactionStatus`, not the block-confirmation
model EVM chains use. Veil surfaces these differences as typed options and
dedicated actions (`requestRecords`, `decrypt`, `transactionStatus`) rather
than papering over them, so the underlying model stays visible while the
call shapes stay familiar.

## Packages

`@provablehq/veil-core` is the base every other package builds on — its client,
action, and transport interfaces are what the rest of Veil extends.

| Package | What it's for |
|---|---|
| [`@provablehq/veil-core`](./packages/core) | Clients, actions, transports, types — the base SDK. Also ships LLM agent (`/agent`) and MCP (`/mcp`) bindings. |
| [`@provablehq/veil-aleo-sdk`](./packages/provable-sdk) | Local accounts, signing, and proving via `@provablehq/sdk`. Builds a client from a private key. |
| [`@provablehq/veil-aleo-wallet-adapter`](./packages/wallet-adapter) | Bridges any Provable-standard wallet (Shield, Leo, Puzzle, Fox) into a Veil client. |
| [`@provablehq/veil-aleo-react-hooks`](./packages/react) | `VeilProvider` + `useVeilWallet()` — wallet connection and clients for React apps. |
| [`@provablehq/shield-swap-sdk`](./packages/shield-swap) | Client for the `shield_swap` AMM/DEX — private swaps, liquidity, and pool reads. |
| [`@provablehq/veil-codegen`](./packages/codegen) | Generates typed bindings from an Aleo program ABI (library + `veil-codegen` CLI). |
| [`@provablehq/veil-aleo-devnode`](./packages/devnode) | Runs and drives a local Aleo devnode for tests. |
| [`@provablehq/veil-leo`](./packages/leo) | Typed wrapper around the `leo` CLI (build, deploy, and more). |
| [`@provablehq/veil-aleo-bridges`](./packages/bridge) | Cross-chain bridge client. In preview, not yet published. |

Every package composes through viem's `extend()` pattern: a client built from
`@provablehq/veil-core` gains DEX, devnode, or Leo actions by extending it with the
matching package, rather than switching to a different client type. See
[Packages](./packages/overview) for how the packages fit together.

## Where to go next

- [Getting Started](./getting-started) — install, build a client, and make
  the first call, for a browser dApp, a Node process holding its own key, or
  a read-only integration.
- [Public Client](./clients/public-client) and [Wallet Client](./clients/wallet-client)
  — the two clients and their actions in full.
- [Working with records](./guides/working-with-records) — Aleo's private
  state model, for a developer coming from account-based chains.
- [Contract instances](./guides/contract-instances) — typed reads and writes
  generated from a program's ABI.
