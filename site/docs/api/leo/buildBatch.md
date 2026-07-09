---
sidebar_position: 4
---

# buildBatch

Compiles several Leo projects sequentially by spawning `leo build` once per
project.

Requires the Leo CLI on `PATH`. Builds run in order, so list dependencies
before the projects that import them.

## Usage

```ts
import { buildBatch } from '@provablehq/veil-leo'

await buildBatch(['./programs/token', './programs/market'])
```

Mixing plain paths with `{ cwd }` objects:

```ts
await buildBatch([
  './programs/token',
  { cwd: './programs/market' },
])
```

## Returns

`Promise<void>`

Resolves once every project has built successfully.

## Parameters

### projects

- **Type:** `Array<string | { cwd?: string }>`

Project directories to build, in order, each given as a path string or a
`{ cwd }` object.

## Errors

Rejects on the first project whose build exits non-zero; later projects in
the array are not built.
