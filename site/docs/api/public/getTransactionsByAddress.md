# getTransactionsByAddress

Fetches the transactions associated with an address.

Queries the connected node, so it hits the network. The result is the
endpoint's wire shape, returned untyped — the caller decodes whatever fields
the node includes. A `getTransitions` action covers the typed case, returning
per-transition summaries for an address instead of raw transaction payloads.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const txs = await client.getTransactionsByAddress({
  address: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
```

## Returns

`unknown[]`

The transactions involving the address, untyped in the endpoint's wire
shape.

## Parameters

### address

- **Type:** `string`

Address whose transactions to fetch.
