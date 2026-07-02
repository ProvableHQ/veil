---
sidebar_position: 10
---

# @veil/bridge

:::caution Preview
`@veil/bridge` is early and not yet published. The API below is subject to
change — treat this page as a preview.
:::

A viem-shaped cross-chain bridge client: fetch quotes, create and track bridge
orders, and perform an Aleo-originated swap (an unshield deposit signed by a
`@veil/core` wallet client, then bridged to a destination chain, asset, and
address).

## Key exports

- **`createBridgeClient(config)`** → a `BridgeClient`.
- **`httpBridge(baseUrl, config?)`** — the bridge transport.
- **Actions** — `getQuotes`, `createOrder`, `getOrder`, `getOrderAudit`, `waitForOrder`, `swap`.
- **Helpers** — `isTerminalStage`, `TERMINAL_STAGES`, `aleoAssetProgram`, `DEFAULT_ALEO_ASSET_MAP`.
- **Errors** — `BridgeError`, `BridgeOrderFailedError`, `BridgeTimeoutError`.

## Usage

```ts
import { createBridgeClient, httpBridge } from '@veil/bridge'

const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
})

const { quotes } = await bridge.getQuotes({
  srcChain: 'aleo',
  destChain: 'ethereum',
  srcAsset: 'USDC',
  destAsset: 'USDC',
  amountIn: '100',
})
```

`swap(...)` additionally takes a `@veil/core` wallet client to sign the Aleo-side
deposit. Aleo is always one side of the pair.
