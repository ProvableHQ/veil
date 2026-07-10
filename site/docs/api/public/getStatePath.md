# getStatePath

Fetches the Merkle state path proving a record commitment's inclusion in the
ledger.

Spending a record requires its state path, so call this when building
execution proofs outside a node. The path verifies against the global state
root (see [`getStateRoot`](/api/public/getStateRoot)). Queries the connected
node, so it hits the network. Use [`getStatePaths`](/api/public/getStatePaths)
to fetch several paths in one round trip.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const path = await client.getStatePath({
  commitment: '5031743...field',
})
// '{"global_state_root":"sr1...","block_path":{...},...}'
```

## Returns

`string`

The serialized state path for the commitment. Per snarkVM's `Serialize`
implementation this arrives as a JSON string — the path's `Display`
representation rather than a parsed object. Callers who need the structured
fields (`global_state_root`, `block_path`, `transaction_leaf`,
`transition_leaf`, and so on) parse the string themselves.

## Parameters

### commitment

- **Type:** `string`

Record commitment, a `field` literal, whose inclusion path to fetch.
