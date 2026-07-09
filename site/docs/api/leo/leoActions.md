---
sidebar_position: 2
---

# leoActions

Extension helper that attaches a `LeoClient` to any veil client under the
`.leo` property.

Pass the return value to `.extend()`. The extension ignores the host client —
Leo operations run locally against a project directory and need no transport
— so it composes with a public, wallet, or test client alike. Every `.leo`
method spawns the `leo` binary as a child process, so the Leo CLI MUST be
installed and on `PATH` (or located via `leoPath`).

## Usage

```ts
import { createTestClient } from '@provablehq/veil-core'
import { leoActions } from '@provablehq/veil-leo'

const testClient = createTestClient({ transport }).extend(
  leoActions({ cwd: './my-program' }),
)

await testClient.leo.build()
await testClient.advanceBlock()
```

## Returns

`(client: Client) => { leo: LeoClient }`

An extend-compatible function. Applying it adds a `.leo` property carrying a
[`LeoClient`](/api/leo/createLeoClient) built from `config`.

## Parameters

### config

- **Type:** `LeoClientConfig`
- **Default:** `{}`

Defaults forwarded to every `leo` invocation made through `.leo`. See
[`createLeoClient`](/api/leo/createLeoClient) for the full field list —
`cwd`, `leoPath`, `network`, `endpoint`, `privateKey`, and the rest of the
global CLI flags.
