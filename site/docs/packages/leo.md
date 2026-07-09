---
sidebar_position: 9
---

# @provablehq/veil-leo

A thin typed wrapper around the `leo` CLI binary, exposing Leo commands
(build, deploy, run, synthesize, clean) as Node async functions with typed
options that map to CLI flags. Applies to driving Leo compilation and
deployment programmatically, standalone or wired into a `TestClient` via
`extend()`. Every method spawns the `leo` binary as a child process, so the
Leo CLI MUST be installed and on `PATH` (or located via a `leoPath` option).

## Installation

```bash
npm install -D @provablehq/veil-leo
```

## Key exports

- **`createLeoClient(config?)`** — returns a `LeoClient` with `.build()`, `.deploy()`, `.synthesize()`, `.abi()`. `config` sets defaults (`cwd`, `network`, `privateKey`, …) forwarded to every command; any can be overridden per call.
- **`leoActions(config?)`** — an `extend()` decorator attaching `.leo` to any Veil client (public, wallet, or test — leo operations don't need the host client's transport).
- **Standalone** — `build`, `buildBatch` (sequential, for multiple projects), `abi` (returns the ABI JSON of a compiled `.aleo` file), `run` (runs `leo run` locally, nothing broadcast), `clean`.

## Example

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { leoActions } from '@provablehq/veil-leo'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(leoActions({ cwd: './my_program' }))

await client.leo.build()
await client.leo.deploy()
```

Commonly paired with [`@provablehq/veil-aleo-devnode`](./devnode) for a full
local compile-deploy-test loop. See the [`/api/leo`](/api/leo/createLeoClient)
pages for every command's option surface.
