# findBlockHeightByStateRoot

Finds the height of the block that produced a state root.

Queries the connected Aleo node, so it hits the network. Applies while
verifying a state path or proof anchored to a state root, to locate the
block it came from. To resolve a block hash to a height instead, use
[`getBlockHeightByHash`](/api/public/getBlockHeightByHash).

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const height = await client.findBlockHeightByStateRoot({ stateRoot: 'sr1...' })
// 100
```

## Returns

`number`

Block height (u32) at which the state root was committed.

## Parameters

### stateRoot

- **Type:** `string`

State root (`sr1...`) whose block height to locate.
