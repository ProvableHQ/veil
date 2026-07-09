# findTransitionId

Finds the id of the transition that consumed or produced a given input or
output id.

Queries the connected Aleo node, so it hits the network. Applies when the
caller holds a record serial number or commitment and needs the transition
that spent or created it; chain into
[`findTransactionId`](/api/public/findTransactionId) for the transaction.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const id = await client.findTransitionId({ inputOrOutputId: '1234...field' })
// 'au1...'
```

## Returns

`string`

Id (`au1...`) of the transition that consumed or produced the input or
output.

## Parameters

### inputOrOutputId

- **Type:** `string`

Input or output id — a field element, such as a record serial number or
commitment — whose transition to locate.
