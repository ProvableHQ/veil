# getBlocks

Retrieves a range of blocks by height.

Queries the connected Aleo node, so it hits the network. Applies when
scanning a window of chain history; for a single block use
[`getBlock`](/api/public/getBlock). The node serves at most 50 blocks per
request, so a larger range must be paged across multiple calls.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const blocks = await client.getBlocks({ start: 100, end: 110 })
// [{ block_hash: 'ab1...', header: { ... }, ... }, ...]
```

## Returns

`Block[]`

The blocks in the requested range, in ascending height order.

## Parameters

### start

- **Type:** `number`

First block height (u32) of the range, inclusive.

### end

- **Type:** `number`

Last block height (u32) of the range, inclusive. The node caps a single
request at 50 blocks; a wider range must be split across multiple calls.
