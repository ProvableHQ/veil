# getBlockHeightByHash

Resolves a block hash to its height.

Queries the connected Aleo node, so it hits the network. Applies when an API
returned a block hash but the height is needed, for example to page through
neighboring blocks with [`getBlocks`](/api/public/getBlocks).

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const height = await client.getBlockHeightByHash({ hash: 'ab1...' })
// 100
```

## Returns

`number`

Height (u32) of the block with the given hash.

## Parameters

### hash

- **Type:** `string`

Block hash (`ab1...`) whose height to resolve.
