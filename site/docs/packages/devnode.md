---
sidebar_position: 8
---

# @veil/devnode

Manages a local Aleo devnode process from Node — start it, advance blocks,
restore snapshots — typically wired into a test client via `extend()` for
integration tests against a local devnet.

```bash
npm install -D @veil/core @veil/devnode
```

## Key exports

- **`devnodeActions`** — an `extend()` decorator adding `startDevnode`, `advanceDevnode`, and `restoreDevnode` to a client.
- **Standalone** — `startDevnode`, `advanceDevnode`, `restoreDevnode`.
- **Constants** — `DEVNODE_PRIVATE_KEY`, `DEVNODE_ADDR` (`127.0.0.1:3030`).

Taking a snapshot is a live REST call, so it lives on the `@veil/core` test
client as `client.snapshot(...)` / `client.listSnapshots()` rather than in this
package; reload one here with `restoreDevnode`.

## Usage

```ts
import { createTestClient, http } from '@veil/core'
import { devnodeActions } from '@veil/devnode'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await client.startDevnode()
await client.advanceBlock({ count: 1 })
await devnode.stop()
```

Pair with [`@veil/leo`](./leo) to compile and deploy programs onto the devnode.
