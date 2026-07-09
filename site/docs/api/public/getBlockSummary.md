# getBlockSummary

Retrieves summaries of the most recent blocks.

Queries the connected Aleo node, so it hits the network. Populates an
explorer-style recent-blocks view without downloading full blocks;
[`getBlocks`](/api/public/getBlocks) returns complete block contents instead.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const summaries = await client.getBlockSummary()
// [{ block_height: 1000, block_hash: 'ab1...', solution_count: 3, transaction_count: 12, ... }, ...]
```

## Returns

`BlockSummary[]`

Summaries of the latest blocks, newest first. Each summary carries
`block_height` (`number`, u32), `block_hash`, `solution_count`,
`transaction_count`, `block_timestamp` (unix seconds, delivered as a
string), and the `coinbase_target` / `proof_target` (`number`, u64) in
effect for that block.
