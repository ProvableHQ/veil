---
sidebar_position: 6
---

# deploy

Compiles and deploys the current Leo package by spawning `leo deploy`.

Requires the Leo CLI on `PATH`. Available only as a `LeoClient` method — there
is no zero-config standalone function, since deployment always needs a
signing key and a target network. Set `broadcast: true` to actually send the
transaction to the network; this costs a fee. Without `broadcast`, `deploy`
compiles and builds the transaction locally without submitting it.

## Usage

```ts
import { createLeoClient } from '@provablehq/veil-leo'

const leo = createLeoClient({
  cwd: './programs/token',
  network: 'testnet',
  privateKey: process.env.LEO_PRIVATE_KEY,
})

await leo.deploy({ broadcast: true, yes: true })
```

Skipping already-deployed dependencies:

```ts
await leo.deploy({ broadcast: true, yes: true, skip: ['credits.aleo'] })
```

## Returns

`Promise<void>`

Resolves once `leo deploy` exits with status 0 — after broadcast and
confirmation search when `broadcast` is set, or after building the
transaction locally otherwise.

## Parameters

### options

- **Type:** `LeoDeployOptions`
- **Default:** `undefined`

Combines the fields below with the compiler flags documented on
[`build`](/api/leo/build) (`LeoCompilerOptions`) and a per-call override of
any [`LeoClientConfig`](/api/leo/createLeoClient) default.

#### options.skip

- **Type:** `string[]`

`--skip`. Skips deployment of any program whose name contains one of these
substrings.

#### options.priorityFees

- **Type:** `string`

`--priority-fees`. Microcredit amounts delimited by `|`, one per program
being deployed.

#### options.feeRecords

- **Type:** `string`

`-f, --fee-records`. Private records to spend for the deployment fee.

#### options.print

- **Type:** `boolean`
- **Default:** `false`

`--print`. Prints the built transaction.

#### options.broadcast

- **Type:** `boolean`
- **Default:** `false`

`--broadcast`. Submits the transaction to the network. This is what actually
costs a fee and changes on-chain state — omit it to build the transaction
without sending it.

#### options.save

- **Type:** `string`

`--save`. Saves the built transaction to the given directory.

#### options.yes

- **Type:** `boolean`
- **Default:** `false`

`-y, --yes`. Skips confirmation prompts.

#### options.consensusVersion

- **Type:** `string`

`--consensus-version`.

#### options.maxWait

- **Type:** `number`

`--max-wait`. Seconds to search for the broadcast transaction before giving
up.

#### options.blocksToCheck

- **Type:** `number`

`--blocks-to-check`. Block window to search when confirming the broadcast
transaction.

## Errors

Rejects if the `leo` binary is missing or the command exits non-zero — for
example on a compile error, an unfunded key, or a broadcast that cannot be
confirmed within `maxWait`.
