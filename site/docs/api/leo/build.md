---
sidebar_position: 3
---

# build

Compiles a Leo project by spawning `leo build`.

Requires the Leo CLI on `PATH`. Two forms exist: a standalone function for
the zero-config path, and a `LeoClient.build` method for compiler flags and
shared defaults.

## Usage

Standalone, for scripts that need nothing beyond a project directory:

```ts
import { build } from '@provablehq/veil-leo'

await build({ cwd: './programs/token' })
```

As a client method, for compiler flags or defaults shared with other
commands:

```ts
import { createLeoClient } from '@provablehq/veil-leo'

const leo = createLeoClient({ cwd: './programs/token' })
await leo.build({ buildTests: true, noCache: true })
```

## Returns

`Promise<void>`

Resolves once `leo build` exits with status 0.

## Parameters

### Standalone `build(options?)`

#### options.cwd

- **Type:** `string`
- **Default:** current working directory

Project directory to build. The standalone function takes no compiler flags
— use `LeoClient.build` when they are needed.

### `LeoClient.build(options?)`

- **Type:** `LeoBuildOptions`
- **Default:** `undefined` — uses the client's constructor defaults with no
  compiler flags set.

Combines the compiler flags below with a per-call override of any
[`LeoClientConfig`](/api/leo/createLeoClient) default (`cwd`, `network`,
`leoPath`, and the rest).

#### options.enableAstSpans

- **Type:** `boolean`
- **Default:** `false`

`--enable-ast-spans`. Includes source spans in AST snapshots.

#### options.enableDce

- **Type:** `boolean`
- **Default:** `false`

`--enable-dce`. Enables dead-code elimination.

#### options.conditionalBlockMaxDepth

- **Type:** `number`

`--conditional-block-max-depth`. Maximum nesting depth the compiler
type-checks in conditional blocks.

#### options.disableConditionalBranchTypeChecking

- **Type:** `boolean`
- **Default:** `false`

`--disable-conditional-branch-type-checking`.

#### options.enableInitialAstSnapshot

- **Type:** `boolean`
- **Default:** `false`

`--enable-initial-ast-snapshot`. Writes the pre-pass AST snapshot.

#### options.enableAllAstSnapshots

- **Type:** `boolean`
- **Default:** `false`

`--enable-all-ast-snapshots`. Writes a snapshot after every compiler pass.

#### options.astSnapshots

- **Type:** `string[]`

`--ast-snapshots`. Names of individual compiler passes to snapshot.

#### options.buildTests

- **Type:** `boolean`
- **Default:** `false`

`--build-tests`. Also compiles the package's tests.

#### options.noCache

- **Type:** `boolean`
- **Default:** `false`

`--no-cache`. Recompiles instead of reusing cached build artifacts.

#### options.noLocal

- **Type:** `boolean`
- **Default:** `false`

`--no-local`. Resolves dependencies from the network instead of local paths.

## Errors

Rejects if the `leo` binary is missing or the build exits non-zero.
