---
sidebar_position: 10
---

# @provablehq/aleo-bridge-sdk

:::caution Preview
The package is private and not yet published to npm. Execution is available for select routes through registry-keyed chain clients; other execution paths remain under development.
:::

The bridge client assigns each asset family to its canonical protocol:

- Circle xReserve moves USDC into and out of Aleo as USDCx.
- Hyperlane Warp Routes move ETH, WBTC, USDT, SOL, ALEO, and USAD.

The current API provides a versioned route registry, discovery, and local
transfer planning:

```ts
import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({ environment: 'mainnet' })
const plan = bridge.prepare({
  source: { chain: 'ethereum', asset: 'usdc' },
  destination: { chain: 'aleo', asset: 'usdcx' },
  bridgeProtocol: 'xreserve',
  amount: '25',
  recipient: aleoAddress,
})
```

`prepare` validates the route, decimal precision, and recipient. It
returns the ordered approval, protocol, attestation/delivery, and destination
steps without signing or moving funds.

Fund-moving actions accept an optional `onCheckpoint` hook. The compact value
contains only its format version, route, protocol, and submitted transaction
identifiers. An uninterrupted application may keep the returned receipt in
memory without storing a checkpoint.

```ts
const execution = await bridge.execute({
  plan,
  onCheckpoint: saveCheckpoint,
})
```

After an interruption, `recover` reconstructs progress through read-only chain
and protocol requests. It never signs, proves, or submits a transaction.

```ts
const receipt = await bridge.recover({
  plan,
  checkpoint: await loadCheckpoint(),
})
```

`getStatus` performs one read-only lifecycle update, while `waitForStatus`
polls until one of the caller's requested states. A private inbound xReserve
mint remains a separate explicit `complete({ plan, receipt })` wallet action.

Hyperlane routes marked `metadata-required` are known route families whose
complete execution deployment has not been pinned yet. Applications MUST NOT
execute them until a reviewed registry marks them active.
