# listSnapshots

Lists the snapshots available on a local devnode.

Applies in tests that need to discover a snapshot name to pass to the
`@provablehq/veil-aleo-devnode` `restoreDevnode` action. Hits the devnode over
the transport. Real networks do not expose this. See
[`snapshot`](/api/test/snapshot) to capture a new one.

## Usage

```ts
import { createTestClient, http } from '@provablehq/veil-core'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})

const names = await client.listSnapshots()
// ['snapshot-42', 'before-deploy']
```

## Returns

`string[]`

The snapshot names a devnode reports, in the order it returns them.
