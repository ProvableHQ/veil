# getBlock

Retrieves a block by height or by hash.

Queries the connected Aleo node, so it hits the network. Returns the full
block: header, authority, ratifications, solutions, and confirmed
transactions. For only a block's transactions, [`getBlockTransactions`](/api/public/getBlockTransactions)
is the lighter call.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const block = await client.getBlock({ height: 100 })
// { block_hash: 'ab1...', previous_hash: 'ab1...', header: { ... }, transactions: [ ... ], ... }
```

## Returns

`Block`

The full block at the given height or hash. See [Block](/api/types#block-types)
for the field-by-field shape.

## Parameters

### height

- **Type:** `number`
- **Optional**

Block height (u32) to fetch. Ignored when `hash` is set.

### hash

- **Type:** `string`
- **Optional**

Block hash (`ab1...`) to fetch. Takes precedence over `height` when both are
given.
