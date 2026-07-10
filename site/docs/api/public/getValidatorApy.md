# getValidatorApy

Fetches the estimated staking APY for each validator.

Applies when choosing a validator to bond to; use
[`getApy`](/api/public/getApy) for the network-wide rate. Queries the
connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const rates = await client.getValidatorApy()
// [{ validator: 'aleo1...', apy: 10.89 }, ...]
```

## Returns

`ValidatorApy[]`

One entry per validator:

- `validator` — validator address (`aleo1...`).
- `apy` — estimated APY as a decimal percentage — `10.89` means ~10.89%.
