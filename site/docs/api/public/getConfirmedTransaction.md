# getConfirmedTransaction

Retrieves a transaction from the ledger together with its confirmation
outcome.

Queries the connected Aleo node, so it hits the network. Unlike
[`getTransaction`](/api/public/getTransaction), which returns the bare
transaction, this wraps it with whether it was accepted or rejected and its
index in the block. Use it when the outcome matters — for example, to confirm
a transfer landed.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const tx = await client.getConfirmedTransaction({ id: 'at1...' })
// { status: 'accepted', type: 'execute', index: 3, transaction: { ... }, finalize: [...] }
```

## Returns

`ConfirmedTransaction`

The confirmed transaction: `status` (`"accepted"` or `"rejected"`), `type`
(`"execute"` | `"deploy"` | `"fee"`), `index` — the transaction's u32 position
within its block — the raw `transaction` body, and its `finalize` operations.

## Parameters

### id

- **Type:** `string`

Transaction id (`at1...`) to fetch from the ledger.
