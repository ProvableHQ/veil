# getTransaction

Fetches a transaction by its `at1…` ID.

Returns the transaction body as stored on chain. For the confirmed wrapper
carrying status and finalize operations, use
[`getConfirmedTransaction`](/api/public/getConfirmedTransaction); for a
transaction's original as-submitted form, use
[`getUnconfirmedTransaction`](/api/public/getUnconfirmedTransaction) — a
rejected transaction's on-chain body differs from what was broadcast. Queries
the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const tx = await client.getTransaction({ id: 'at1...' })
// { type: 'execute', id: 'at1...', execution: { transitions: [...], ... }, fee: { ... } }
```

## Returns

`Transaction`

The transaction body: its `type` (`"execute"` | `"deploy"` | `"fee"`), `id`,
an `execution` (present on execute transactions) or `deployment` (present on
deploy transactions), and a `fee` execution. Deploy transactions also carry an
`owner` — the deployer's address and signature.

## Parameters

### id

- **Type:** `string`

Transaction id (`at1...`) to fetch.

## Errors

Throws when the node does not know the transaction id.
