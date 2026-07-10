# getBlockTransactionsByHash

Retrieves summary rows for the transactions in a block, looked up by block
hash.

Queries the connected Aleo node, so it hits the network. Returns lightweight
summaries — id, fee, status, program and function called — rather than full
transactions; use [`getBlockTransactions`](/api/public/getBlockTransactions)
with a height for the complete confirmed transactions.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const { transactions } = await client.getBlockTransactionsByHash({ hash: 'ab1...' })
// [{ id: 'at1...', fee: 264, status: 'accepted', block_height: 100, program_id: 'credits.aleo', function_id: 'transfer_public', ... }]
```

## Returns

`{ transactions: BlockTransactionSummary[] }`

One summary row per transaction in the block. Each row carries the
transaction `id` (`at1...`), the `fee` paid in microcredits (u64), the
`status` (`'accepted'` or `'rejected'`), the containing block's
`block_height` (u32), `block_timestamp` (unix seconds, as a string) and
`block_hash`, and the `transaction_type`, `program_id`, and `function_id` of
the root transition.

## Parameters

### hash

- **Type:** `string`

Block hash (`ab1...`) whose transactions to fetch.
