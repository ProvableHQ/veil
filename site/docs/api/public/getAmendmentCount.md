# getAmendmentCount

Retrieves the number of amendments applied to the latest edition of a
program.

Aleo programs are upgradeable. A program upgrade creates a new edition of the
program, and amendments are the upgrade transactions that produced each
edition. Use `getAmendmentCount` to check whether a deployed program has been
amended since its edition was published; use
[`getAmendmentCountByEdition`](/api/public/getAmendmentCountByEdition) to
inspect a specific edition. Queries the connected node, so it hits the
network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const { amendment_count } = await client.getAmendmentCount({ programId: 'token.aleo' })
// { program_id: 'token.aleo', edition: 2, amendment_count: 3 }
```

## Returns

`{ program_id: string; edition: number; amendment_count: number }`

The program, its latest edition, and that edition's amendment count.
`amendment_count` is 0 when the edition is unamended.

## Parameters

### programId

- **Type:** `string`

Program (e.g. `token.aleo`) whose amendments to count.
