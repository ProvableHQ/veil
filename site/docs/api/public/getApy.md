# getApy

Retrieves the current network-wide staking APY.

Queries the connected Aleo node, so it hits the network. Use it to show an
estimated staking yield; use
[`getValidatorApy`](/api/public/getValidatorApy) for per-validator rates.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const apy = await client.getApy()
// 10.9
```

## Returns

`number`

The current APY as a decimal percentage — `10.9` means 10.9%.
