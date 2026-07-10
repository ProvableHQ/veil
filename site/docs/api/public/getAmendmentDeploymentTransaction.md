# getAmendmentDeploymentTransaction

Retrieves the id of the transaction that applied a specific amendment to a
program edition.

Aleo programs are upgradeable. A program upgrade creates a new edition of the
program, and amendments are the upgrade transactions that produced each
edition. Use `getAmendmentDeploymentTransaction` when tracing how a program
changed: [`getAmendmentCountByEdition`](/api/public/getAmendmentCountByEdition)
gives the number of amendments, and this resolves each one to its
transaction. Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const txId = await client.getAmendmentDeploymentTransaction({
  programId: 'token.aleo',
  edition: 0,
  amendment: 0,
})
// 'at1...'
```

## Returns

`string | null`

The transaction id (`at1...`), or `null` if no such amendment exists.

## Parameters

### programId

- **Type:** `string`

Program (e.g. `token.aleo`) whose amendment to look up.

### edition

- **Type:** `number`

Edition the amendment was applied to. Editions start at 0.

### amendment

- **Type:** `number`

Amendment index within the edition, starting at 0.
