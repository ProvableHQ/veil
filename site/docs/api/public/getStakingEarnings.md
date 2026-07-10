# getStakingEarnings

Fetches the cumulative staking rewards earned by an address.

Queries the connected node, so it hits the network. Use it to show a
staker's lifetime earnings; use [`getApy`](/api/public/getApy) or
[`getValidatorApy`](/api/public/getValidatorApy) for forward-looking yield.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const earnings = await client.getStakingEarnings({
  address: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
// { total_rewards: 42000000, at_block: 1520340 }
```

## Returns

`StakingEarnings`

- `total_rewards` — cumulative rewards in microcredits (u64, widened to
  `number`).
- `at_block` — the block height at which the total was computed.

## Parameters

### address

- **Type:** `string`

Staker address (`aleo1...`) whose earnings to fetch.
