---
sidebar_position: 1
---

# createLeoClient

Creates a `LeoClient` whose methods shell out to the `leo` CLI.

Construction is cheap and does nothing on its own — no process is spawned
until a method is called. Every method spawns the `leo` binary as a child
process, so the Leo CLI MUST be installed and on `PATH` (or located via
`leoPath`); see the
[Leo installation guide](https://developer.aleo.org/leo/installation).
Applies when a script or test needs a standalone client to compile, generate
an ABI for, deploy, or synthesize keys for a Leo project. Use
[`leoActions`](/api/leo/leoActions) instead when a veil client is already in
hand.

## Usage

```ts
import { createLeoClient } from '@provablehq/veil-leo'

const leo = createLeoClient({ cwd: './programs/token', network: 'testnet' })

await leo.build()
const abiJson = await leo.abi({ file: './build/token/token.aleo' })
```

## Returns

`LeoClient`

An object exposing `config` (the options the client was constructed with) and
the methods `build`, `abi`, `deploy`, and `synthesize` — see
[`build`](/api/leo/build), [`abi`](/api/leo/abi), [`deploy`](/api/leo/deploy),
and [`synthesize`](/api/leo/synthesize). Each method rejects if the `leo`
binary is missing or the underlying command exits non-zero.

## Parameters

### config

- **Type:** `LeoClientConfig`
- **Default:** `{}` — the `leo` binary is resolved on `PATH` and every command
  runs in the current working directory.

Defaults applied to every command the client runs. Any method can override a
field per call by passing the same key in its own options.

#### config.cwd

- **Type:** `string`

Default project root, equivalent to `--path`. Individual methods can still
override it per call via their own `cwd` option.

#### config.leoPath

- **Type:** `string`
- **Default:** `'leo'`

Path to the `leo` binary, resolved on `PATH` by default.

#### config.network

- **Type:** `'mainnet' | 'testnet' | 'canary'`

Default `--network`.

#### config.endpoint

- **Type:** `string`

Default `--endpoint` URL.

#### config.privateKey

- **Type:** `string`

Default `--private-key`.

#### config.devnet

- **Type:** `boolean`
- **Default:** `false`

Default `--devnet`, marking the target as a devnet.

#### config.home

- **Type:** `string`

Default `--home` — path to the Aleo program registry.

#### config.quiet

- **Type:** `boolean`
- **Default:** `false`

Default `-q`, suppressing `leo` CLI output.

#### config.debug

- **Type:** `boolean`
- **Default:** `false`

Default `-d`, printing additional debug info.

#### config.disableUpdateCheck

- **Type:** `boolean`
- **Default:** `false`

Default `--disable-update-check`.

#### config.networkRetries

- **Type:** `number`

Default `--network-retries`.

#### config.consensusHeights

- **Type:** `string`

Default `--consensus-heights`.

#### config.offline

- **Type:** `boolean`
- **Default:** `false`

Default `--offline`.
