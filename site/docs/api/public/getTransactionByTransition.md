# getTransactionByTransition

Fetches a full transaction by transition ID.

Composes two REST calls: one to resolve the transaction id from the
transition id, then one to fetch the transaction body. Applies when an event
or record only carries a transition id (`au1…`) and the enclosing transaction
is needed. Hits the network twice.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const tx = await client.getTransactionByTransition({ transitionId: 'au1...' })
// { type: 'execute', id: 'at1...', execution: { transitions: [...], ... }, fee: { ... } }
```

## Returns

`Transaction`

The full transaction containing the transition, in the same shape returned by
[`getTransaction`](/api/public/getTransaction).

## Parameters

### transitionId

- **Type:** `string`

Transition id (`au1…`) contained in the transaction to fetch.

## Errors

Throws when the node does not know the transition id.

## Related

Composes [`findTransactionId`](/api/public/findTransactionId) and
[`getTransaction`](/api/public/getTransaction). Call them separately to reuse
the resolved transaction id without refetching the body.
