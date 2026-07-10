# getStateRoot

Fetches the ledger's global state root, at a given height or the latest block.

The state root commits to the entire ledger; the state paths returned by
[`getStatePath`](/api/public/getStatePath) verify against it. Applies when
checking inclusion proofs or anchoring off-chain data to a ledger state.
Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const root = await client.getStateRoot()
// 'sr1...'

const historical = await client.getStateRoot({ height: 100_000 })
// 'sr1...'
```

## Returns

`string`

The global state root (`sr1...`) at the requested height, or the latest
height when `height` is omitted.

## Parameters

### height

- **Type:** `number`
- **Optional**
- **Default:** the latest block

Block height to fetch the state root at.
