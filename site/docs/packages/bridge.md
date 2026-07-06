---
sidebar_position: 10
---

# @veil/bridge

:::caution Preview
`@veil/bridge` is early and not yet published. The API below is subject to
change — treat this page as a preview.
:::

A viem-shaped client for Provable's cross-chain bridge: discover routes,
fetch quotes, create and track orders, and perform an Aleo-originated swap in
one call (an unshield deposit signed by a `@veil/core` wallet client, then
bridged to a destination chain, asset, and address). Aleo is always one side
of the pair.

## Key exports

- **`createBridgeClient(config)`** → a `BridgeClient`; pass `wallet` (a
  `@veil/core` WalletClient) to enable `swap`.
- **`httpBridge(baseUrl, config?)`** — the bridge transport.
- **Discovery** — `getAssets` (the identifier catalog), `getProviders`,
  `getRoutes` (derived candidate pairs, filterable by symbol / chain /
  provider), `getFlags`.
- **Actions** — `getQuotes`, `createOrder`, `getOrder`, `getOrderAudit`,
  `waitForOrder`, `swap`.
- **Helpers** — `chainDisplayName`, `resolveChainId`, `parseDecimalAmount`,
  `isTerminalStage`, `TERMINAL_STAGES`, `aleoAssetProgram`,
  `DEFAULT_ALEO_ASSET_MAP`.
- **Errors** — `BridgeError`, `BridgeEnvelopeError`, `BridgeOrderFailedError`,
  `BridgeTimeoutError`.
- **Agent surfaces** — `createBridgeAgentTools` (`@veil/bridge/agent`),
  `createBridgeMcpServer` (`@veil/bridge/mcp`) — composable with other
  packages' tools via core's `toMcpServer`.

## Identifiers

The API is strict about identifiers: chains are case-sensitive ids (`ALEO`,
`SOLANA`, `EVM:1`), assets are chain-qualified codes (`ALEO_MAINNET`,
`USDC_ETH` — never bare symbols), and amounts are decimal strings in display
units. Don't hardcode any of them — discover:

```ts
import { createBridgeClient, httpBridge } from '@veil/bridge'

const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
  wallet: walletClient, // a @veil/core WalletClient — required for swap below
})

// What can move where, relative to Aleo? Filter by symbol and chain name.
const routes = await bridge.getRoutes({ symbol: 'SOL', externalChain: 'Solana' })
const route = routes.find((r) => r.aleoAsset.native && r.externalAsset.native)!
route.externalAsset.code       // 'SOL_SOLANA'
route.externalAsset.chainName  // 'Solana'
route.providers                // e.g. ['NEAR_INTENTS', 'HALLIDAY']
```

Candidates mean supportability; a live `getQuotes` for your direction and
amount is the confirmation.

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
