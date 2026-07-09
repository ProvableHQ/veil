# getBlockHash

Retrieves the hash of the latest block.

Queries the connected Aleo node, so it hits the network. Gives a chain-tip
identifier as a hash; [`getBlockNumber`](/api/public/getBlockNumber) gives
the tip as a height instead.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const hash = await client.getBlockHash()
// 'ab1...'
```

## Returns

`string`

Hash (`ab1...`) of the block at the current chain tip.
