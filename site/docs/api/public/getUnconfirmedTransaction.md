# getUnconfirmedTransaction

Fetches a transaction in its original, as-submitted form.

What lands on chain can differ from what was broadcast: a rejected execution
is stored with its transitions replaced by the fee. Use this to inspect the
original payload of a rejected transaction; use
[`getTransaction`](/api/public/getTransaction) for the on-chain form and
[`getConfirmedTransaction`](/api/public/getConfirmedTransaction) for the
confirmed wrapper. Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const original = await client.getUnconfirmedTransaction({ id: 'at1...' })
// { type: 'execute', id: 'at1...', execution: { transitions: [...], ... }, fee: { ... } }
```

## Returns

`Transaction`

The transaction as originally submitted, before any substitution the ledger
applies on rejection.

## Parameters

### id

- **Type:** `string`

Transaction id (`at1...`) to fetch.

## Errors

Throws when the node does not know the transaction id.
