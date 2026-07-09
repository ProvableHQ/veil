# getLatestEdition

Fetches the newest edition number of a program.

Aleo programs are upgradeable. A program upgrade creates a new edition of the
program, and amendments are the upgrade transactions that produced each
edition. Use `getLatestEdition` to find the current edition before fetching a
historical version with [`getProgramByEdition`](/api/public/getProgramByEdition).
Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const edition = await client.getLatestEdition({ programId: 'credits.aleo' })
// 0
```

## Returns

`number`

The latest edition number. 0 means the program has never been upgraded.

## Parameters

### programId

- **Type:** `string`

Program whose newest edition to look up, such as `"credits.aleo"`.
