# getCirculatingSupply

Retrieves the circulating supply of Aleo credits.

Queries the connected Aleo node, so it hits the network. Circulating supply
excludes locked and unvested credits;
[`getTotalSupply`](/api/public/getTotalSupply) reports the total minted
supply instead.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const supply = await client.getCirculatingSupply()
// 1523000000
```

## Returns

`number`

The circulating supply, in credits (not microcredits).
