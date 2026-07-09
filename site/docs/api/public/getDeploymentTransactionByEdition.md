# getDeploymentTransactionByEdition

Retrieves the id of the transaction that deployed a specific edition of a
program.

Aleo programs are upgradeable. A program upgrade creates a new edition of the
program, and amendments are the upgrade transactions that produced each
edition. Use `getDeploymentTransactionByEdition` when tracing a program's
upgrade history edition by edition;
[`getDeploymentTransaction`](/api/public/getDeploymentTransaction) covers the
common case without an edition number. Queries the connected node, so it hits
the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const txId = await client.getDeploymentTransactionByEdition({
  programId: 'token.aleo',
  edition: 1,
})
// 'at1...'
```

## Returns

`string`

Id (`at1...`) of the transaction that deployed the edition.

## Parameters

### programId

- **Type:** `string`

Program (e.g. `token.aleo`) whose deployment to find.

### edition

- **Type:** `number`

Edition whose deployment to find. Editions start at 0.
