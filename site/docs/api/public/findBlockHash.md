# findBlockHash

Finds the hash of the block that contains a transaction.

Queries the connected Aleo node, so it hits the network. Resolves a
transaction id to its block; follow up with
[`getBlock`](/api/public/getBlock)`({ hash })` for the full block.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const hash = await client.findBlockHash({ transactionId: 'at1...' })
// 'ab1...'
```

## Returns

`string`

Hash (`ab1...`) of the block the transaction was accepted into.

## Parameters

### transactionId

- **Type:** `string`

Transaction id (`at1...`) whose containing block to locate.
