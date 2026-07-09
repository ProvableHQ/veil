---
sidebar_position: 4
---

# Test Client

A test client drives a local Aleo devnode — operations a real network never
exposes: mining blocks on demand, reading a program mapping's full contents
in one call, and snapshotting or restoring ledger state between test runs.
Its transport must point at a devnode; pointed at a public network endpoint,
every action fails or hangs, since none of these methods exist on the node's
public REST API.

`@provablehq/veil-aleo-devnode` and `@provablehq/veil-leo` extend a test
client further: the first adds process control over the `aleo-devnode`
binary itself (start it, advance it, restore a snapshot into it), and the
second adds a `.leo` property for compiling and deploying Leo programs
against the same client used to call them. A devnode-backed integration test
typically composes all three.

## Create a test client

```ts
import { createTestClient, http } from '@provablehq/veil-core'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})
```

`createTestClient` takes a `TestClientConfig`:

| Field | Type | Description |
| --- | --- | --- |
| `transport` | `Transport` | Points at a running devnode's REST API. |
| `key` | `string` (optional) | Identifier for the client's type. Defaults to `'test'`. |
| `name` | `string` (optional) | Human-readable name. Defaults to `'Test Client'`. |

## Actions

These built-in actions hit the devnode over the client's transport — no
process management involved, so they apply to any already-running devnode:

| Action | Description |
| --- | --- |
| [`advanceBlock`](/api/test/advanceBlock) | Mines one or more blocks, moving the chain forward. Requires the devnode to run with `--manual-block-creation`. |
| [`getMappingKeysValues`](/api/test/getMappingKeysValues) | Reads every key/value pair in a program mapping — a devnode-only operation, since a real network's REST API serves one mapping value per request. |
| [`snapshot`](/api/test/snapshot) | Captures the current ledger state as a named snapshot. Requires the devnode to run with persistent storage. |
| [`listSnapshots`](/api/test/listSnapshots) | Lists the snapshots a devnode holds. |
| [`shutdown`](/api/test/shutdown) | Asks the devnode to stop accepting work and exit. |

## Composing with devnode process control

The test client's built-in actions assume a devnode is already running.
`@provablehq/veil-aleo-devnode` adds the actions that start, advance, and
restore the process itself, composing with `extend` the same way the core
client decorators do:

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

| Action | Description |
| --- | --- |
| [`startDevnode`](/api/devnode/startDevnode) | Spawns the `aleo-devnode` binary and waits until its REST API answers. |
| [`advanceDevnode`](/api/devnode/advanceDevnode) | Mines blocks on a running devnode by spawning `aleo-devnode advance`. |
| [`restoreDevnode`](/api/devnode/restoreDevnode) | Restores a devnode's ledger from a named snapshot, optionally relaunching it. |

`devnodeActions` needs no options of its own — every option lives on the
individual action calls — and it ignores the host client's transport
entirely, since process management needs no network request. That also
means it composes onto a public or wallet client, not only a test client,
though pairing it with a test client keeps process control
(`startDevnode`/`advanceDevnode`/`restoreDevnode`) and ledger inspection
(`snapshot`/`listSnapshots`/`getMappingKeysValues`) on one object. See
[`@provablehq/veil-aleo-devnode`](/packages/devnode) and
[Local Devnode](/guides/devnode) for the full workflow, including
`DEVNODE_PRIVATE_KEY`, the seeded and pre-funded account devnode mines
with by default.

## Composing with Leo

`@provablehq/veil-leo` attaches a `LeoClient` under `.leo`, for compiling,
generating an ABI for, and deploying a Leo program from the same test that
drives the devnode:

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { devnodeActions } from '@provablehq/veil-aleo-devnode'
import { leoActions } from '@provablehq/veil-leo'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})
  .extend(devnodeActions)
  .extend(leoActions({ cwd: './programs/token', network: 'testnet' }))

await client.startDevnode()
await client.leo.build()
await client.leo.deploy()
await client.advanceBlock()
```

Like `devnodeActions`, `leoActions` ignores the host client — Leo operations
run locally against a project directory, spawning the `leo` binary as a
child process, so the Leo CLI MUST be installed and on `PATH` (or located
via `leoPath` in the config). See
[`leoActions`](/api/leo/leoActions) for the full `LeoClientConfig` field
list forwarded to every `.leo` call, and
[`@provablehq/veil-leo`](/packages/leo) for the package overview.

## Zero-config devnode client

For a test that only needs a funded account and a client pair — not the
process-control or Leo actions above — `createDevnodeClient` from
`@provablehq/veil-aleo-sdk` wires up a `publicClient`/`walletClient`/`account`
triple pointed at `127.0.0.1:3030` with the devnode's seeded key, no
`loadNetwork` call required:

```ts
import { createDevnodeClient } from '@provablehq/veil-aleo-sdk'

const { publicClient, walletClient, account } = createDevnodeClient()

const txId = await walletClient.writeContract({
  program: 'credits.aleo',
  function: 'transfer_public',
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

See [`createDevnodeClient`](/api/provable-sdk/createDevnodeClient) for the
`privateKey`/`socketAddr` overrides.

## `extend()`

`createTestClient` builds on the base client and layers `testActions` on
with `extend` — the same pattern `createPublicClient` and
`createWalletClient` use, and the same mechanism `devnodeActions` and
`leoActions` use to add their own properties on top. Each `extend` call
returns a new client carrying everything an earlier call attached, so the
three examples above can all run against one client instance without
interfering with each other.
