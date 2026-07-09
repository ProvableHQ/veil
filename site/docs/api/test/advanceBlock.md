# advanceBlock

Mines blocks on a local devnode to move the chain forward.

Applies in tests that need a pending transaction confirmed, or a
height-gated condition met, without waiting for real block production. Hits
the devnode over the transport; the devnode MUST be running with
`--manual-block-creation`. Real networks do not expose this method.

## Usage

```ts
import { createTestClient, http } from '@provablehq/veil-core'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})

await client.advanceBlock({ count: 5 })
// mines 5 blocks, one request per block
```

## Returns

`void`

Resolves once the devnode has produced the requested blocks.

## Parameters

### count

- **Type:** `number`
- **Optional**
- **Default:** `1`

Number of blocks to mine. The devnode's block-creation endpoint mines exactly
one block per request, so `advanceBlock` issues `count` sequential requests —
each block builds on the last, so the requests cannot run concurrently.
