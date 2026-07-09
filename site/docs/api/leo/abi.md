---
sidebar_position: 5
---

# abi

Generates the ABI of a compiled `.aleo` file by spawning `leo abi` and
capturing its output.

Requires the Leo CLI on `PATH`. Two forms exist: a standalone function for
the zero-config path, and a `LeoClient.abi` method that adds network context
and an output-file flag. The target `.aleo` file MUST already exist — call
[`build`](/api/leo/build) first when generating from source.

## Usage

Standalone:

```ts
import { abi } from '@provablehq/veil-leo'

const json = await abi({ file: 'build/token/token.aleo', cwd: './programs/token' })
```

As a client method, to write straight to a file or parse under a specific
network:

```ts
import { createLeoClient } from '@provablehq/veil-leo'

const leo = createLeoClient({ cwd: './programs/token' })
await leo.abi({ file: 'build/token/token.aleo', network: 'testnet', output: 'token.abi.json' })
```

## Returns

`Promise<string>`

The ABI JSON captured from stdout, raw — a trailing newline may be present;
`JSON.parse` tolerates it. `LeoClient.abi` returns an empty string when
`output` is given, since the ABI is written to that path instead.

## Parameters

### Standalone `abi(options)`

#### options.file

- **Type:** `string`

Path to the compiled `.aleo` bytecode file, relative to `cwd`.

#### options.cwd

- **Type:** `string`
- **Default:** current working directory

Project directory.

### `LeoClient.abi(options)`

- **Type:** `LeoAbiOptions`

Accepts `file` as above, plus:

#### options.network

- **Type:** `'mainnet' | 'testnet' | 'canary'`
- **Default:** `'testnet'` (applied server-side by the `leo` CLI)

Network context for parsing.

#### options.output

- **Type:** `string`

`-o, --output`. Writes the ABI to this path instead of returning it.

`LeoClient.abi` also accepts a per-call override of any
[`LeoClientConfig`](/api/leo/createLeoClient) default except `network`, which
is redefined above for the parsing context.

## Errors

Rejects if the `leo` binary is missing or the command exits non-zero.
