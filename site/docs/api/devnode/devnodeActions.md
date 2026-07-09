---
sidebar_position: 4
---

# devnodeActions

Adds devnode management actions to a test client via `.extend`.

Each action delegates to the standalone function of the same name —
[`startDevnode`](/api/devnode/startDevnode),
[`advanceDevnode`](/api/devnode/advanceDevnode), and
[`restoreDevnode`](/api/devnode/restoreDevnode) — and spawns the
`aleo-devnode` binary, so `aleo-devnode` MUST be installed and on `PATH`. The
extension ignores the host client entirely, since devnode process management
needs no transport; it composes with the client's built-in test actions
(`snapshot`, `listSnapshots`) so one client both drives the process and
captures ledger state.

## Usage

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { devnodeActions } from '@provablehq/veil-aleo-devnode'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await client.startDevnode()
await client.advanceDevnode({ numBlocks: 1 })
await client.restoreDevnode({ snapshot: 'before-deploy', restart: true })
await devnode.stop()
```

## Returns

`DevnodeClientActions`

An object with `startDevnode`, `advanceDevnode`, and `restoreDevnode`
properties, each matching the parameters and return type of its standalone
function.

## Parameters

None. `devnodeActions` takes the client from `.extend` and needs no options of
its own; every option lives on the individual action calls.

## Constants

### DEVNODE_ADDR

`'127.0.0.1:3030'`

Default local devnode socket address. Used as the default `socketAddr` across
`startDevnode`, `advanceDevnode`, and `restoreDevnode`.

### DEVNODE_PRIVATE_KEY

`'APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH'`

The well-known seeded private key devnode uses for block creation. The
matching account is funded with credits from genesis, so it can pay fees the
moment the node boots.
