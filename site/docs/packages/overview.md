---
sidebar_position: 1
---

# Packages

Veil is a set of focused `@provablehq/veil-*` packages. `@provablehq/veil-core` is the base — every
other package builds on its client, action, and transport interfaces.

| Package | What it's for |
|---|---|
| [`@provablehq/veil-core`](./core) | Clients, actions, transports, types — the base SDK. Also ships LLM agent (`/agent`) and MCP (`/mcp`) bindings. |
| [`@provablehq/veil-sdk`](./provable-sdk) | Local accounts, signing, and proving via `@provablehq/sdk`. Build a client from a private key. |
| [`@provablehq/veil-wallet-adapter`](./wallet-adapter) | Bridge any Provable-standard wallet (Shield, Leo, Puzzle, Fox) into a Veil client. |
| [`@provablehq/veil-react`](./react) | `VeilProvider` + `useVeilWallet()` — wallet connection and clients for React apps. |
| [`@provablehq/veil-shield-swap`](./shield-swap) | Client for the `shield_swap` AMM/DEX — private swaps, liquidity, and the DEX API. |
| [`@provablehq/veil-codegen`](./codegen) | Generate typed bindings from an Aleo program ABI (library + `veil-codegen` CLI). |
| [`@provablehq/veil-devnode`](./devnode) | Run and drive a local Aleo devnode for tests. |
| [`@provablehq/veil-leo`](./leo) | Typed wrapper around the `leo` CLI (build, deploy, …). |
| [`@provablehq/veil-bridge`](./bridge) | Cross-chain bridge client (preview). |

## How they fit together

- **Read-only or server-side?** `@provablehq/veil-core` + `@provablehq/veil-sdk`.
- **Browser dApp with a wallet?** `@provablehq/veil-core` + `@provablehq/veil-wallet-adapter` (or `@provablehq/veil-react`).
- **Trading the DEX?** `@provablehq/veil-shield-swap` on top of either signer path.
- **Typed contract bindings?** `@provablehq/veil-codegen`.
- **Local testing?** `@provablehq/veil-devnode` (+ `@provablehq/veil-leo` to compile/deploy).

Everything composes through viem's `extend()` pattern, so a single client can
carry base actions plus any domain surface (DEX, devnode, …).
