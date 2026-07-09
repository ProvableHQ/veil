---
sidebar_position: 7
---

# synthesize

Synthesizes proving and verifying keys for a program by spawning
`leo synthesize`.

Requires the Leo CLI on `PATH`. Available only as a `LeoClient` method.
Applies when the proving/verifying keys for a program's functions are needed
ahead of deployment or local proving, without deploying the program itself.

## Usage

```ts
import { createLeoClient } from '@provablehq/veil-leo'

const leo = createLeoClient({ cwd: './programs/token', network: 'testnet' })

await leo.synthesize({ name: 'token.aleo' })
```

Synthesizing from the local project and skipping a function:

```ts
await leo.synthesize({ name: 'token.aleo', local: true, skip: ['mint_private'] })
```

## Returns

`Promise<void>`

Resolves once `leo synthesize` exits with status 0.

## Parameters

- **Type:** `LeoSynthesizeOptions`

Combines the fields below with the compiler flags documented on
[`build`](/api/leo/build) (`LeoCompilerOptions`), the transaction flags
documented on [`deploy`](/api/leo/deploy) (`LeoTransactionOptions`), and a
per-call override of any [`LeoClientConfig`](/api/leo/createLeoClient)
default.

### options.name

- **Type:** `string`

Program name, e.g. `'helloworld.aleo'`. Required.

### options.local

- **Type:** `boolean`
- **Default:** `false`

`-l, --local`. Uses the local Leo project instead of a published one.

### options.skip

- **Type:** `string[]`

`-s, --skip`. Skips functions whose names contain one of these substrings.

## Errors

Rejects if the `leo` binary is missing or the command exits non-zero.
