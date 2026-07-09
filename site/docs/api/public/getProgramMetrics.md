# getProgramMetrics

Fetches call counts for every program on the network.

Queries the connected node, so it hits the network. Use it to rank programs
by activity or gauge a program's usage against the rest of the network; use
[`getProgramMetricsByRange`](/api/public/getProgramMetricsByRange) for one
program's daily history.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const metrics = await client.getProgramMetrics()
// [{ program_id: 'credits.aleo', calls: 9823145 }, ...]
```

## Returns

`ProgramMetricPoint[]`

One entry per program:

- `program_id` — the program's on-chain id.
- `calls` — total number of calls into the program.
