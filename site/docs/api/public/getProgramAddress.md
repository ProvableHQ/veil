# getProgramAddress

Resolves a program ID to its on-chain address.

Every deployed program owns an `aleo1…` address derived from its ID. Use it
when a program appears as a party to a transfer, or to check a program's
public credits balance. Queries the connected node, so it hits the network.
Use [`getProgramIdByAddress`](/api/public/getProgramIdByAddress) for the
reverse lookup.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const address = await client.getProgramAddress({ programId: 'credits.aleo' })
// 'aleo1...'
```

## Returns

`string`

The program's `aleo1…` address.

## Parameters

### programId

- **Type:** `string`

Program whose address to resolve, such as `"credits.aleo"`.
