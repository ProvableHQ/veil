# getProgramIdByAddress

Resolves a program's on-chain address to its program ID.

Inverse of [`getProgramAddress`](/api/public/getProgramAddress). Use it to
identify which program owns an `aleo1…` address seen in a transfer or
transition. Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const programId = await client.getProgramIdByAddress({ address: 'aleo1...' })
// 'credits.aleo'
```

## Returns

`string`

The ID of the program that owns the address, such as `"credits.aleo"`.

## Parameters

### address

- **Type:** `string`

Program account address (`aleo1…`) to look up.
