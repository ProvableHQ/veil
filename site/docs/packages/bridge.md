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
contains its format version, public transfer intent, resolved route, and
submitted transaction identifiers. It excludes wallet secrets, private-mint
nonces, records, proofs, and protocol response bodies.

```ts
const execution = await bridge.execute({
  plan,
  onCheckpoint: saveCheckpoint,
})
```

After an interruption, `recover` reconstructs progress through read-only chain
and protocol requests. It never signs, proves, or submits a transaction.

```ts
const progress = await bridge.recover({
  checkpoint: await loadCheckpoint(),
})
```

`recover` rebuilds the runtime plan and returns `next: 'wait' | 'resume' |
'complete' | 'done' | 'failed'`. `wait({ progress })` polls to the next caller
boundary, `resume({ progress })` continues an approval-interrupted source flow,
and `complete({ progress })` authorizes a private destination mint. The
lower-level `getStatus` and `waitForStatus` remain available for exact states.

Hyperlane routes marked `metadata-required` are known route families whose
complete execution deployment has not been pinned yet. Applications MUST NOT
execute them until a reviewed registry marks them active.
