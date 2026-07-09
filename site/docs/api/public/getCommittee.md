# getCommittee

Retrieves the validator committee, either current or at a past height.

Queries the connected Aleo node, so it hits the network. Use it to see which
validators are producing blocks and their bonded stake; use
[`getDelegators`](/api/public/getDelegators) to see who is bonded to a
specific validator.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const committee = await client.getCommittee()
// { id: '7field', starting_round: 1520, members: { 'aleo1...': [10000000000, true, 5], ... } }
```

Pass `height` to audit committee membership at a past block:

```ts
const past = await client.getCommittee({ height: 1_200_000 })
```

## Returns

`Committee`

The committee membership at the requested point in the chain, with the
following shape:

- `id` — committee id, a field element serialized as a string.
- `starting_round` — the round at which this committee took effect.
- `members` — a map from validator address to a `[stake, isOpen, commission]`
  tuple, where `stake` is the validator's bonded stake in microcredits (u64,
  widened to `number`), `isOpen` is whether the validator accepts new
  delegators, and `commission` is the validator's commission percentage (u8).

## Parameters

### height

- **Type:** `number`
- **Default:** the latest committee

Optional block height (u32) at which to read the committee. Pass a height to
audit historical validator membership.
