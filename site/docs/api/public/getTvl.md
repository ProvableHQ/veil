# getTvl

Fetches the total value locked in each DeFi protocol on the network.

Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const tvl = await client.getTvl()
// [{ protocol_name: 'shield-swap', total_value: 4200000 }, ...]
```

## Returns

`TvlEntry[]`

One entry per protocol:

- `protocol_name` — the protocol's display name.
- `total_value` — total value locked, in credits (not microcredits).
