# getStatePaths

Batch state-path lookup for multiple commitments in one call.

Use this over repeated [`getStatePath`](/api/public/getStatePath) calls when
proving several records — one round trip instead of one per commitment.
Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const paths = await client.getStatePaths({
  commitments: ['5031743...field', '2960987...field'],
})
// ['{"global_state_root":"sr1...",...}', '{"global_state_root":"sr1...",...}']
```

## Returns

`string[]`

One serialized state path per requested commitment, in the same order as
`commitments`. Each entry has the same JSON-string shape returned by
`getStatePath`.

## Parameters

### commitments

- **Type:** `string[]`

Record commitments (`field` literals) to prove, fetched in one request.
