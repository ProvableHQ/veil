# getBalance

Retrieves the public credits balance of an account.

Reads the `credits.aleo` `account` mapping on the connected node. This covers
only the public balance — credits held in private records are not included
and MUST be summed from the owner's unspent records instead (see
[Working with records](/guides/working-with-records)).

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const balance = await client.getBalance({
  address: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
// 250000000n
```

## Returns

`bigint`

The public balance in microcredits. The value is a u64 on chain, widened to
`bigint` for viem parity.

## Parameters

### address

- **Type:** `string`

Account (`aleo1...`) whose public balance to read.
