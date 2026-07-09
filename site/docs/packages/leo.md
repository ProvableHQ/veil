---
sidebar_position: 9
---

# @provablehq/veil-leo

A thin typed wrapper around the `leo` CLI binary, exposing Leo commands (build,
deploy, run, synthesize, clean) as Node async functions with typed options that
map to CLI flags. Use it to drive Leo compilation and deployment
programmatically — standalone or wired into a test client via `extend()`.

```bash
npm install -D @provablehq/veil-leo
```

Requires the `leo` binary on your `PATH`.

## Key exports

- **`createLeoClient(config?)`** → a `LeoClient` with `.build()`, `.deploy()`, `.synthesize()`, `.abi()`.
- **`leoActions(config?)`** — an `extend()` decorator attaching `.leo` to a client.
- **Standalone** — `build`, `buildBatch`, `abi` (returns the ABI JSON of a compiled `.aleo` file), `run` (runs `leo run`), `clean`.

## Usage

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { leoActions } from '@provablehq/veil-leo'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(leoActions({ cwd: './my_program' }))

await client.leo.build()
await client.leo.deploy()
```

Commonly paired with [`@provablehq/veil-devnode`](./devnode) for a full local
compile → deploy → test loop.
