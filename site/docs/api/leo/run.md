---
sidebar_position: 8
---

# run

Executes a function of the local Leo project by spawning `leo run`.

Requires the Leo CLI on `PATH`. Runs the transition locally against the
project at `cwd` — nothing is broadcast to a network.

## Usage

```ts
import { run } from '@provablehq/veil-leo'

await run({ function: 'mint', inputs: ['1000u64'], cwd: './programs/token' })
```

## Returns

`Promise<void>`

Resolves once `leo run` exits with status 0.

## Parameters

### options.function

- **Type:** `string`

Function name to call. `leo run` resolves the program from the project at
`cwd`.

### options.inputs

- **Type:** `string[]`
- **Default:** `[]`

Inputs to pass to the function, as Leo literals (e.g. `'1000u64'`).

### options.cwd

- **Type:** `string`
- **Default:** current working directory

Path to the Leo project directory.

## Errors

Rejects if the `leo` binary is missing or the run exits non-zero — for
example on a type error or a failing assertion.
