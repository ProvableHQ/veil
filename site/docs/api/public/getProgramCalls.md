# getProgramCalls

Fetches the latest calls made into a program.

Returns the node's most-recent-calls feed as untyped elements. Use
[`getProgramCallsPaginated`](/api/public/getProgramCallsPaginated) instead
for typed results or to page through the full call history. Queries the
connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const calls = await client.getProgramCalls({ programId: 'credits.aleo' })
// [{ transaction_id: 'at1...', function_id: 'transfer_public', block_number: 100, ... }, ...]
```

## Returns

`unknown[]`

The latest calls into the program, in the endpoint's untyped wire shape.

## Parameters

### programId

- **Type:** `string`

Program whose latest calls to fetch, such as `"credits.aleo"`.
