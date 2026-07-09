---
sidebar_position: 10
---

# @provablehq/veil-aleo-bridges

:::caution Preview
`@provablehq/veil-aleo-bridges` is early and not yet published to npm (`private: true`
in its `package.json`). The API below is subject to change — treat this page
as a preview.
:::

A viem-shaped client for Provable's cross-chain bridge: discover routes,
fetch quotes, create and track orders, and perform an Aleo-originated swap in
one call — an unshield deposit signed by a `@provablehq/veil-core` wallet
client, then bridged to a destination chain, asset, and address. Aleo is
always one side of the pair; the bridge moves value between Aleo and any
other supported chain, in either direction.

## Installation

Not yet published — the package builds only from the `veil` monorepo as a
workspace dependency until it leaves preview.

## Key exports

- **`createBridgeClient(config)`** — returns a `BridgeClient`; pass `wallet` (a `@provablehq/veil-core` WalletClient) to enable `swap`.
- **`bridgeActions(config?)`** — the `extend()`-style alternative: binds the same actions onto an existing client instead of constructing a standalone one.
- **`httpBridge(baseUrl, config?)`** — the bridge transport.
- **Discovery** — `getAssets` (the identifier catalog), `getProviders`, `getRoutes` (derived candidate pairs, filterable by symbol / chain / provider), `getFlags`.
- **Actions** — `getQuotes`, `createOrder`, `getOrder`, `getOrderAudit`, `waitForOrder`, `swap`.
- **Helpers** — `chainDisplayName`, `resolveChainId`, `parseDecimalAmount`, `isTerminalStage`, `TERMINAL_STAGES`, `aleoAssetProgram`, `DEFAULT_ALEO_ASSET_MAP`.
- **Errors** — `BridgeError`, `BridgeEnvelopeError`, `BridgeOrderFailedError`, `BridgeTimeoutError`.
- **Agent surfaces** — `createBridgeAgentTools` (`@provablehq/veil-aleo-bridges/agent`), `createBridgeMcpServer` (`@provablehq/veil-aleo-bridges/mcp`) — composable with other packages' tools via core's `toMcpServer`.

## Identifiers

The API is strict about identifiers: chains are case-sensitive ids (`ALEO`,
`SOLANA`, `EVM:1`), assets are chain-qualified codes (`ALEO_MAINNET`,
`USDC_ETH` — never bare symbols), and amounts are decimal strings in display
units. None of them should be hardcoded — discover them instead:

```ts
import { createBridgeClient, httpBridge } from '@provablehq/veil-aleo-bridges'

const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
  wallet: walletClient, // a @provablehq/veil-core WalletClient — required for swap below
})

// What can move where, relative to Aleo? Filter by symbol and chain name.
const routes = await bridge.getRoutes({ symbol: 'SOL', externalChain: 'Solana' })
const route = routes.find((r) => r.aleoAsset.native && r.externalAsset.native)!
route.externalAsset.code       // 'SOL_SOLANA'
route.externalAsset.chainName  // 'Solana'
route.providers                // e.g. ['NEAR_INTENTS', 'HALLIDAY']
```

A route candidate means supportability; a live `getQuotes` call for the
intended direction and amount is the confirmation.

## Swapping out of Aleo

```ts
const result = await bridge.swap({
  from: { asset: route.aleoAsset.code, amount: '100' },
  to: {
    chain: route.externalAsset.chainName, // id or display name — both accepted
    asset: route.externalAsset.code,
    address: solAddress,
  },
  provider: 'NEAR_INTENTS', // optional: pin the provider (throws pre-funds if it doesn't quote)
  poll: true,               // wait for COMPLETED
})
result.depositTxId // at1... — the signed Aleo deposit
```

Bridging **in** starts on the other chain, so the deposit is signed there:
quote and `createOrder` from this SDK, then pay the returned deposit
instructions from the source-chain wallet (with viem, for EVM chains).

See the [package README](https://github.com/ProvableHQ/veil/tree/main/packages/bridge)
for providers, the live route snapshot, error semantics, and the gated
integration tests, including the full mainnet swap-chain e2e.
