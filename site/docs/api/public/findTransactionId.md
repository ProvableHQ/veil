# findTransactionId

Finds the id of the transaction that contains a transition.

Queries the connected Aleo node, so it hits the network. Applies when an
event or record points at a transition and the enclosing transaction is
needed; follow up with `getTransaction({ id })` for its contents.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const id = await client.findTransactionId({ transitionId: 'au1...' })
// 'at1...'
```

## Returns

`string`

Id (`at1...`) of the transaction that contains the transition.

## Parameters

### transitionId

- **Type:** `string`

Transition id (`au1...`) whose parent transaction to locate.

## Related

Chain into [`getTransaction`](/api/public/getTransaction) for the transaction
body, or use
[`getTransactionByTransition`](/api/public/getTransactionByTransition) to do
both in one call.
