---
sidebar_position: 10
---

# @provablehq/aleo-bridge-sdk

:::caution Preview
The package is private and not yet published to npm. Execution is available for select routes via injected wallet executors; other execution paths remain under development.
:::

The bridge client assigns each asset family to its canonical protocol:

- Circle xReserve moves USDC into and out of Aleo as USDCx.
- Hyperlane Warp Routes move ETH, WBTC, USDT, SOL, ALEO, and USAD.

The current API provides a versioned route registry, discovery, and local
transfer planning:

```ts
import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({ environment: 'mainnet' })
const [route] = bridge.getRoutes({
  protocol: 'xreserve',
  sourceChainId: 'ethereum',
  destinationChainId: 'aleo',
})

const plan = bridge.prepareTransfer({
  routeId: route.id,
  amount: '25',
  recipient: aleoAddress,
})
```

`prepareTransfer` validates the route, decimal precision, and recipient. It
returns the ordered approval, protocol, attestation/delivery, and destination
steps without signing or moving funds.

Hyperlane routes marked `metadata-required` are known route families whose
complete execution deployment has not been pinned yet. Applications MUST NOT
execute them until a reviewed registry marks them active.
