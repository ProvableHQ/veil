# getDelegators

Retrieves the addresses of all delegators bonded to a validator.

Queries the connected Aleo node, so it hits the network. Use it to inspect a
validator's delegation base; pair with
[`getCommittee`](/api/public/getCommittee) for the validator's own stake and
open/closed status.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const delegators = await client.getDelegators({
  validator: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
// ['aleo1...', 'aleo1...']
```

## Returns

`string[]`

The delegator addresses (`aleo1...`) currently bonded to the validator.

## Parameters

### validator

- **Type:** `string`

Validator address (`aleo1...`) whose delegators to list.
