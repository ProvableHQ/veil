# getCode

Retrieves the source code of a deployed program.

Queries the connected Aleo node, so it hits the network. The result is the
program's Aleo instructions text — Veil's analogue of viem's `getCode`, which
returns bytecode. Use it to inspect a program's functions, mappings, and
record types before calling it. `getProgram` is an alias for `getCode`.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const source = await client.getCode({ programId: 'credits.aleo' })
// 'program credits.aleo;\n\nmapping account:\n    key as address.public;\n    value as u64.public;\n...'
```

## Returns

`string`

The program source as Aleo instructions text. Fetches the current edition;
use [`getProgramByEdition`](/api/public/getProgramByEdition) for a historical
version and [`getLatestEdition`](/api/public/getLatestEdition) to find the
newest edition number.

## Parameters

### programId

- **Type:** `string`

Program (e.g. `credits.aleo`) whose source to fetch.
