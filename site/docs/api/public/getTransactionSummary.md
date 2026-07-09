# getTransactionSummary

Fetches summaries of the most recent transactions network-wide.

Each summary carries the transaction id, fee in microcredits, status, block
placement, and the program and function called. Use for an explorer-style
latest-transactions feed; [`getTransaction`](/api/public/getTransaction)
returns a full body. Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const latest = await client.getTransactionSummary()
// [{ id: 'at1...', fee: 264, status: 'Accepted', block_height: 100, ... }, ...]
```

## Returns

`TransactionSummary[]`

One summary per recent transaction, newest first. Each entry carries the
transaction `id` (`at1...`), `fee` in microcredits (u64), `status` (`"Accepted"`
or `"Rejected"` — capitalized on this endpoint, unlike the lowercase status
values elsewhere in the API), `block_height` (u32), `block_timestamp` (unix
seconds, as a string on the wire), `block_hash`, `transaction_type`
(`"Execute"` | `"Deploy"` | `"Fee"`, also capitalized), `program_id`, and
`function_id`.
