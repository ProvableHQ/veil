---
name: aleo-bridge
description: Integrate Aleo bridge routes using the packaged Circle xReserve and Hyperlane examples, including quoting, execution, and recovery.
---

# Bridge SDK

Start with the [packaged tutorial](../examples/README.md). It lists supported
example routes, dependencies, environment variables, and execution commands.
The examples use the public `@provablehq/aleo-bridge-sdk` API and ship in the
npm package; a repository checkout is not required.

## Locate the installed resources

From the consuming project, resolve this guide or the tutorial without assuming
a package manager's directory layout:

```sh
node -p "require.resolve('@provablehq/aleo-bridge-sdk/skills/SKILL.md')"
node -p "require.resolve('@provablehq/aleo-bridge-sdk/examples/README.md')"
```

Follow the tutorial's install and copy instructions before running TypeScript.
Copy the whole examples directory: route entrypoints import sibling helpers.

## Choose a route

- Circle xReserve: `usdc-to-usdcx.ts` and `usdcx-to-usdc.ts`.
- Ethereum to Aleo through Hyperlane: `eth-to-aleo.ts` and `wbtc-to-aleo.ts`.
- Aleo to Ethereum through Hyperlane: `eth-to-ethereum.ts`,
  `wbtc-to-ethereum.ts`, and `usdt-to-ethereum.ts`.
- Solana through Hyperlane: `sol-to-aleo.ts` and `sol-to-solana.ts`.

Read the selected script and its helper before executing. These examples target
mainnet. They quote without submitting by default; submission requires the
explicit `EXECUTE_BRIDGE` acknowledgement documented in the tutorial. Review
the configured route, amount, recipient, balances, and fees first.

## Follow the lifecycle

Use `quote` to obtain the transfer plan, then `execute` and `wait`. Persist
`onCheckpoint` output when a transfer must survive process interruption. A
polling timeout does not prove transaction failure: use `recover` with the
saved checkpoint and follow its returned next operation instead of repeating
`execute`. `resume` and `complete` may require another transaction signature.
Store private keys and private-mint secret nonces separately from checkpoints.

The package README documents the public SDK API. The `/agent` and `/mcp`
entrypoints expose structured tooling; these Markdown and TypeScript resources
provide the integration walkthrough.
