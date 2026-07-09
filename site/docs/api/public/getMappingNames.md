# getMappingNames

Retrieves the names of the on-chain mappings a program declares.

Queries the connected Aleo node, so it hits the network. Use it to discover
what public state a program exposes before reading values with
[readContract](/api/public/readContract) or
[readMapping](/api/public/readMapping).

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const mappings = await client.getMappingNames({ programId: 'credits.aleo' })
// ['account', 'committee', 'bonded', 'unbonding', ...]
```

## Returns

`string[]`

The program's mapping names. Empty if the program declares none.

## Parameters

### programId

- **Type:** `string`

Program (e.g. `"credits.aleo"`) whose mappings to list.
