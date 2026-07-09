---
sidebar_position: 9
---

# clean

Deletes a Leo project's build artifacts by spawning `leo clean`.

Requires the Leo CLI on `PATH`. Use before a build when cached artifacts are
suspect.

## Usage

```ts
import { clean, build } from '@provablehq/veil-leo'

await clean({ cwd: './programs/token' })
await build({ cwd: './programs/token' })
```

## Returns

`Promise<void>`

Resolves once `leo clean` exits with status 0.

## Parameters

### options

- **Type:** `LeoCleanOptions`
- **Default:** `undefined` — cleans the current working directory.

#### options.cwd

- **Type:** `string`
- **Default:** current working directory

Path to the Leo project directory to clean.

## Errors

Rejects if the `leo` binary is missing or the command exits non-zero.
