# getOriginalDeploymentTransaction

Retrieves the id of the transaction that originally deployed a program
edition, before any amendments.

Aleo programs are upgradeable. A program upgrade creates a new edition of the
program, and amendments are the upgrade transactions that produced each
edition. Use `getOriginalDeploymentTransaction` to see an amended edition's
deployment as it was first published;
[`getAmendmentDeploymentTransaction`](/api/public/getAmendmentDeploymentTransaction)
resolves the individual amendments that followed. Queries the connected node,
so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const txId = await client.getOriginalDeploymentTransaction({
  programId: 'token.aleo',
  edition: 0,
})
// 'at1...'
```

## Returns

`string | null`

The original deployment transaction id, or `null` if none exists (e.g. genesis
programs like `credits.aleo`).

## Parameters

### programId

- **Type:** `string`

Program (e.g. `token.aleo`) whose original deployment to find.

### edition

- **Type:** `number`

Edition whose original deployment to find. Editions start at 0.
