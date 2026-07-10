# getProgramMetricsByRange

Fetches a program's daily call counts over a trailing window.

Queries the connected node, so it hits the network. Use it to chart one
program's activity over time; use
[`getProgramMetrics`](/api/public/getProgramMetrics) for a network-wide
snapshot.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const points = await client.getProgramMetricsByRange({
  programId: 'credits.aleo',
  days: 30,
})
// [{ day: '2026-04-20', calls: 15230 }, ...]
```

## Returns

`ProgramMetricsDayPoint[]`

One point per day in the requested window:

- `day` — day bucket, as an ISO-8601 date string.
- `calls` — number of calls into the program that day.

## Parameters

### programId

- **Type:** `string`

Program whose activity to fetch, e.g. `credits.aleo`.

### days

- **Type:** `30 | 60 | 90`

Trailing window in days. The endpoint accepts only these three values.
