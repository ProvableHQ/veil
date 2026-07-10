# getBlockTransactions

Retrieves the confirmed transactions in a block at a given height.

Queries the connected Aleo node, so it hits the network. Applies when only a
block's transactions are needed; [`getBlock`](/api/public/getBlock) returns
them along with the header. Given a block hash instead of a height, use
[`getBlockTransactionsByHash`](/api/public/getBlockTransactionsByHash).

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const txs = await client.getBlockTransactions({ height: 100 })
// [{ status: 'accepted', type: 'execute', index: 0, transaction: { ... }, finalize: [ ... ] }, ...]
```

## Returns

`ConfirmedTransaction[]`

The block's confirmed transactions, each carrying its `status` (`'accepted'`
or `'rejected'`) alongside the raw transaction and its finalize effects. See
[Transaction status](/api/types#transaction-status) for the full status
vocabulary.

## Parameters

### height

- **Type:** `number`

Block height (u32) whose transactions to fetch.
