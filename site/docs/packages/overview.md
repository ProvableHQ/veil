---
sidebar_position: 1
---

# Packages

Veil is a set of focused `@provablehq/veil-*` packages rather than one
monolithic SDK. `@provablehq/veil-core` defines the client, transport, and
action interfaces every other package builds on; the rest add a signing
strategy, a framework binding, typed program bindings, or a domain client on
top of it.

| Package | What it's for |
| --- | --- |
| [`@provablehq/veil-core`](./core) | Clients, actions, transports, and types — the base SDK. Ships LLM agent (`/agent`) and MCP (`/mcp`) bindings for the base Aleo actions. |
| [`@provablehq/veil-aleo-sdk`](./provable-sdk) | Local accounts, signing, and proving via `@provablehq/sdk`. Builds a client from a private key or mnemonic. |
| [`@provablehq/veil-aleo-wallet-adapter`](./wallet-adapter) | Adapts a connected Provable-standard wallet (Shield, Leo, Puzzle, Fox) into a Veil account and transport. |
| [`@provablehq/veil-aleo-react-hooks`](./react) | `VeilProvider` and `useVeilWallet()` for React apps — wallet connection and clients with no adapter wiring. |
| [`@provablehq/shield-swap-sdk`](./shield-swap) | Client for the `shield_swap_v3.aleo` concentrated-liquidity AMM — private swaps, liquidity, and the DEX API. |
| [`@provablehq/veil-codegen`](./codegen) | Generates typed TypeScript bindings from an Aleo program ABI (library and `veil-codegen` CLI). |
| [`@provablehq/veil-aleo-devnode`](./devnode) | Starts and drives a local Aleo devnode process for integration tests. |
| [`@provablehq/veil-leo`](./leo) | Typed wrapper around the `leo` CLI — build, deploy, run, synthesize. |
| [`@provablehq/veil-aleo-bridges`](./bridge) | Cross-chain bridge client (preview, not yet published). |

## Choosing packages

Every setup starts from `@provablehq/veil-core` and adds the signer or
framework layer that matches where the private key lives.

Read-only or server-side access, where the code only queries chain state,
needs `@provablehq/veil-core` on its own — a `PublicClient` over an `http`
transport covers it.

A CLI, server, or custodial service that holds a private key directly pairs
`@provablehq/veil-core` with `@provablehq/veil-aleo-sdk`, which wraps the
Provable WASM SDK to sign and prove — locally or delegated — under that key.
Adding `@provablehq/veil-leo` builds or deploys Leo programs from the same
process, and `@provablehq/veil-codegen` generates typed bindings for the
contracts it calls.

A browser dApp where the connected wallet holds the key pairs
`@provablehq/veil-core` with `@provablehq/veil-aleo-wallet-adapter`, or with
`@provablehq/veil-aleo-react-hooks` in a React app — the hooks package wraps
the adapter and the core client so the app never touches a private key.

An agent that calls Aleo starts from `@provablehq/veil-core` plus its
`/agent` (tool schemas) and `/mcp` (MCP tools) entry points. An agent that
signs unattended adds `@provablehq/veil-aleo-sdk` for a local key; one behind
a connected wallet adds `@provablehq/veil-aleo-wallet-adapter` instead. See
[Agents](/guides/agents).

Integrating Shield Swap always starts with `@provablehq/shield-swap-sdk` on
top of a client, paired the same way: `@provablehq/veil-aleo-react-hooks` in a
frontend, `@provablehq/veil-aleo-sdk` for an agent trader or a programmatic
bot. Read-only pool and price queries need only a transport — no key,
proving, or scanner.

Local testing against a devnet pairs `@provablehq/veil-aleo-devnode` — to
start and advance a local node — with `@provablehq/veil-leo` — to compile and
deploy programs onto it — extended onto a `TestClient`. See
[Testing against a devnode](/guides/devnode).

Every package composes through viem's `extend()` pattern, so one client can
carry base actions plus any domain surface — DEX, devnode, Leo — at once.
