# getProgramByEdition

Fetches a program's source at a specific edition.

Aleo programs are upgradeable. A program upgrade creates a new edition of the
program, and amendments are the upgrade transactions that produced each
edition. Use `getProgramByEdition` to inspect a historical version — use
[`getCode`](/api/public/getCode) for the current source and
[`getLatestEdition`](/api/public/getLatestEdition) to find the newest edition
number. Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const original = await client.getProgramByEdition({ programId: 'token.aleo', edition: 0 })
// 'program token.aleo;\n\n...'
```

## Returns

`string`

The program source (Aleo instructions text) at the requested edition.

## Parameters

### programId

- **Type:** `string`

Program whose source to fetch, such as `"credits.aleo"`.

### edition

- **Type:** `number`

Edition to fetch. 0 is the original deployment; each upgrade increments the
edition.
