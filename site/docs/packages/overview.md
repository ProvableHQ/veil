---
sidebar_position: 1
---

# Packages

Veil is a set of focused `@veil/*` packages. `@veil/core` is the base — every
other package builds on its client, action, and transport interfaces.

| Package | What it's for |
|---|---|
| [`@veil/core`](./core) | Clients, actions, transports, types — the base SDK. Also ships LLM agent (`/agent`) and MCP (`/mcp`) bindings. |
| [`@veil/provable`](./provable) | Local accounts, signing, and proving via `@provablehq/sdk`. Build a client from a private key. |
| [`@veil/wallet-adapter`](./wallet-adapter) | Bridge any Provable-standard wallet (Shield, Leo, Puzzle, Fox) into a Veil client. |
| [`@veil/react`](./react) | `VeilProvider` + `useVeilWallet()` — wallet connection and clients for React apps. |
| [`@veil/shield-swap`](./shield-swap) | Client for the `shield_swap` AMM/DEX — private swaps, liquidity, and the DEX API. |
| [`@veil/codegen`](./codegen) | Generate typed bindings from an Aleo program ABI (library + `veil-codegen` CLI). |
| [`@veil/devnode`](./devnode) | Run and drive a local Aleo devnode for tests. |
| [`@veil/leo`](./leo) | Typed wrapper around the `leo` CLI (build, deploy, …). |
| [`@veil/bridge`](./bridge) | Cross-chain bridge client (preview). |

## How they fit together

- **Read-only or server-side?** `@veil/core` + `@veil/provable`.
- **Browser dApp with a wallet?** `@veil/core` + `@veil/wallet-adapter` (or `@veil/react`).
- **Trading the DEX?** `@veil/shield-swap` on top of either signer path.
- **Typed contract bindings?** `@veil/codegen`.
- **Local testing?** `@veil/devnode` (+ `@veil/leo` to compile/deploy).

Everything composes through viem's `extend()` pattern, so a single client can
carry base actions plus any domain surface (DEX, devnode, …).
