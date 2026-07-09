# getBlockNumber

Retrieves the latest block height.

Queries the connected Aleo node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const height = await client.getBlockNumber()
const block = await client.getBlock({ height: Number(height) })
```

## Returns

`bigint`

The height of the block at the current chain tip. The height is a u32 on
chain but is widened to `bigint` to match viem's `getBlockNumber`; convert
with `Number()` before passing it to an action that takes a height, such as
[`getBlock`](/api/public/getBlock).
