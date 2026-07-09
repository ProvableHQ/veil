# getTotalSupply

Fetches the total supply of Aleo credits.

Queries the connected node, so it hits the network. Use
[`getCirculatingSupply`](/api/public/getCirculatingSupply) for the
circulating portion.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const supply = await client.getTotalSupply()
// 1600000000
```

## Returns

`number`

The total supply, in credits (not microcredits).
