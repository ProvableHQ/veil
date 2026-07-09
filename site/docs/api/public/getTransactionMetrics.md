# getTransactionMetrics

Fetches daily transaction counts for the network.

Queries the connected node, so it hits the network. Use it to chart network
activity over time.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const points = await client.getTransactionMetrics()
// [{ day: '2026-04-20T00:00:00.000Z', count: 154302 }, ...]
```

## Returns

`TransactionMetricPoint[]`

One point per day:

- `day` — day bucket, as an ISO-8601 date string.
- `count` — number of transactions that day.
