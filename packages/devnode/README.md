# @provablehq/veil-devnode

Runs and drives a local Aleo development node from TypeScript. Reach for it in
tests, CI, and local development when you need a real node to broadcast against
without touching testnet — start one, mine blocks on demand, and tear it down.

The node is seeded with a well-known genesis account (`DEVNODE_PRIVATE_KEY`)
that holds credits, so you have a funded key to pay fees from the moment it
boots.

## Installation

```sh
pnpm add @provablehq/veil-devnode @provablehq/veil-core
```

`@provablehq/veil-devnode` drives the `aleo-devnode` binary as a subprocess — it does not
bundle a node. The binary MUST be installed and resolvable on `PATH` (override
its location per call with `devnodePath`). Every function throws with an
install-and-PATH hint if it cannot find or run the binary.

## Usage

`startDevnode` spawns the node and resolves once its REST API answers, so the
returned instance is ready to receive transactions. Call `stop` to terminate it
(SIGTERM); starting again on the same socket shuts down any node already there
first.

```ts
import { startDevnode, advanceDevnode, DEVNODE_ADDR } from '@provablehq/veil-devnode'

const devnode = await startDevnode({
  socketAddr: DEVNODE_ADDR, // '127.0.0.1:3030'
  storagePath: '',          // '' → default ./devnode dir; omit for in-memory
})

// ... broadcast transactions against http://127.0.0.1:3030 ...

await advanceDevnode({ numBlocks: 1 }) // mine a block so a broadcast finalizes

await devnode.stop()
```

`advanceDevnode` mines blocks on a running node — pair it with
`manualBlockCreation` on `startDevnode` when you want deterministic block
timing instead of automatic creation. `restoreDevnode` reloads ledger state
from a named snapshot, optionally restarting the node afterward.

Taking a snapshot is a live REST call against the running node, not a binary
subcommand, so it lives on the `@provablehq/veil-core` test client as `snapshot` (with
`listSnapshots` to enumerate them) rather than in this package. Capture state
with `client.snapshot(...)` and reload it here with `restoreDevnode` — the node
must have been started with `storagePath`, since an in-memory node has nothing
to snapshot.

### As test-client actions

`devnodeActions` folds the process-lifecycle functions onto a `@provablehq/veil-core` test
client via `.extend`, so a single client drives the node (start/advance/restore)
and, through the core test actions, snapshots it.

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { devnodeActions } from '@provablehq/veil-devnode'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await client.startDevnode({ storagePath: '' })
await client.advanceDevnode({ numBlocks: 1 })
const { name } = await client.snapshot({ name: 'before-deploy' }) // core test action
// ...run something you may want to undo...
await client.restoreDevnode({ snapshot: name, restart: true })
await devnode.stop()
```

## Exports

- `startDevnode(options?)` — spawn a node; resolves to a `DevnodeInstance` once
  the REST API is ready.
- `advanceDevnode(options?)` — mine one or more blocks on a running node.
- `restoreDevnode(options)` — restore ledger state from a snapshot.
- `devnodeActions` — `.extend` decorator that adds the above to a client.
- `DEVNODE_PRIVATE_KEY` — the seeded, funded genesis account key.
- `DEVNODE_ADDR` — the default socket address, `127.0.0.1:3030`.

See the JSDoc on `DevnodeStartOptions`, `DevnodeAdvanceOptions`, and
`DevnodeRestoreOptions` for every flag, its default, and the CLI switch it maps
to.
