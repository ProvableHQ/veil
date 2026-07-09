# getTransitions

Fetches transition summaries involving an address.

Each summary carries the program and function called, the amount for credits
transfers, the containing transaction, and its status. Use it to build an
address's activity history. Queries the connected node, so it hits the
network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const transitions = await client.getTransitions({
  address: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
// [{ id: 'au1...', transaction_status: 'Accepted', transaction_id: 'at1...', program_id: 'credits.aleo', function_id: 'transfer_public', amount: '1.5', ... }]
```

## Returns

`TransitionSummary[]`

One summary per transition involving the address. Each entry carries the
transition `id` (`au1...`), `transaction_status` (`"Accepted"` or
`"Rejected"`), the containing `transaction_id` (`at1...`), `block_height`
(u32), `program_id`, `function_id`, the `amount` involved as a decimal string
(for `credits.aleo` transfers), `block_timestamp` (unix seconds, numeric on
this endpoint), and optional `sender_address` / `recipient_address`.

## Parameters

### address

- **Type:** `string`

Address (`aleo1...`) whose transitions to fetch.
