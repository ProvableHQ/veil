# snapshot

Captures the current ledger state of a local devnode as a named snapshot.

Applies in tests that need to save a point to return to later, then reload it
with the `@provablehq/veil-aleo-devnode` `restoreDevnode` action. Hits the
devnode over the transport; the node MUST be running with persistent storage
(`storagePath`) — an in-memory node has nothing to snapshot. Real networks do
not expose this. See [`listSnapshots`](/api/test/listSnapshots) to discover
the names a devnode already holds.

## Usage

```ts
import { createTestClient, http } from '@provablehq/veil-core'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})

const { name, height } = await client.snapshot({ name: 'before-deploy' })
// { name: 'before-deploy', height: 42 }
```

## Returns

`{ name: string, height: number }`

The saved snapshot's `name` — the requested name, or the auto-generated one
when none was requested — and the block `height` (a u32) at which the ledger
was captured.

## Parameters

### name

- **Type:** `string`
- **Optional**

Snapshot name. When omitted, the devnode auto-names it from the current block
height, for example `snapshot-42`.
