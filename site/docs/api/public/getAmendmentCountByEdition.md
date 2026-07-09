# getAmendmentCountByEdition

Retrieves the number of amendments applied to a specific edition of a
program.

Aleo programs are upgradeable. A program upgrade creates a new edition of the
program, and amendments are the upgrade transactions that produced each
edition. Applies when auditing an older edition;
[`getAmendmentCount`](/api/public/getAmendmentCount) covers the latest
edition without needing an edition number. Queries the connected node, so it
hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const { amendment_count } = await client.getAmendmentCountByEdition({
  programId: 'token.aleo',
  edition: 0,
})
// { program_id: 'token.aleo', edition: 0, amendment_count: 1 }
```

## Returns

`{ program_id: string; edition: number; amendment_count: number }`

The program, the requested edition, and that edition's amendment count.
`amendment_count` is 0 when the edition is unamended.

## Parameters

### programId

- **Type:** `string`

Program (e.g. `token.aleo`) whose amendments to count.

### edition

- **Type:** `number`

Edition to count amendments for. Editions start at 0.
