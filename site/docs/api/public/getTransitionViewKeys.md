# getTransitionViewKeys

Requests the transition view keys for a transaction's transitions.

A transition view key lets its holder decrypt that transition's encrypted
inputs and outputs. Use this to reveal a private transaction to an auditor or
indexer without sharing the account's view key. Served by wallet-backed
transports — the plain `http` node transport rejects this method — and the
wallet may prompt the account holder before responding.

## Usage

```ts
import { createPublicClient, custom } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: custom({
    request: async ({ method, params }) => window.aleo.request({ method, params }),
  }),
})

const viewKeys = await client.getTransitionViewKeys({ transactionId: 'at1...' })
// ['...', '...'] — one opaque view key per revealed transition
```

## Returns

`string[]`

One view key per transition the wallet agrees to reveal.

## Parameters

### transactionId

- **Type:** `string`

Transaction id (`at1…`) whose transition view keys to request.

## Errors

Throws when the transport does not support the method, or the wallet
declines the request.
