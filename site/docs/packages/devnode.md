---
sidebar_position: 8
---

# @provablehq/veil-aleo-devnode

Manages a local Aleo devnode process from Node — starts it, advances blocks,
restores snapshots — typically wired into a `TestClient` via `extend()` for
integration tests against a local devnet. Every method spawns the
`aleo-devnode` binary as a child process, so it MUST be installed and on
`PATH` (or located via a `devnodePath` option).

## Installation

```bash
npm install -D @provablehq/veil-core @provablehq/veil-aleo-devnode
```

## Key exports

- **`devnodeActions`** — an `extend()` decorator adding `startDevnode`, `advanceDevnode`, and `restoreDevnode` to a client.
- **Standalone** — `startDevnode`, `advanceDevnode`, `restoreDevnode`.
- **Constants** — `DEVNODE_PRIVATE_KEY` (the well-known seeded key), `DEVNODE_ADDR` (`'127.0.0.1:3030'`).

Taking a snapshot is a live REST call against a running node, so it lives on
the `@provablehq/veil-core` test client itself — `client.snapshot(...)` and
`client.listSnapshots()` — rather than in this package. `restoreDevnode` here
reloads one from disk.

## Example

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { devnodeActions } from '@provablehq/veil-aleo-devnode'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await client.startDevnode()
await client.advanceDevnode({ numBlocks: 1 })
await devnode.stop()
```

By default the devnode binds `127.0.0.1:3030`, keeps its ledger in memory, and
produces blocks automatically after each broadcast. Pass `manualBlockCreation:
true` to `startDevnode` to gate confirmation on an explicit `advanceDevnode`
call instead. Pair with [`@provablehq/veil-leo`](./leo) to compile and deploy
programs onto the devnode, and see
[Testing against a devnode](/guides/devnode) and the
[`/api/devnode`](/api/devnode/startDevnode) pages for the full option surface.
