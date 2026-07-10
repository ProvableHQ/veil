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
import { devnodeActions, DEVNODE_PRIVATE_KEY } from '@provablehq/veil-aleo-devnode'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await client.startDevnode()
await client.advanceDevnode({ numBlocks: 1 })
await client.restoreDevnode({
  snapshot: 'before-deploy',
  restart: true,
  // privateKey is required when restart is true, unless the $PRIVATE_KEY
  // environment variable is set.
  privateKey: DEVNODE_PRIVATE_KEY,
})
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

## Writing end-to-end tests

The pieces above compose into a real test file once vitest's lifecycle hooks
wrap them: start the devnode and deploy the program under test once in
`beforeAll`, exercise it across as many `it` blocks as the suite needs, and
stop the devnode in `afterAll` so the child process does not outlive the
test run. `startDevnode`, `client.leo.build()`, and `client.leo.deploy()` are
already promises, so the hooks need nothing beyond `await`.

The test client (extended with `devnodeActions` and `leoActions`) owns
process control and compilation; a `createDevnodeClient()` triple makes the
calls into the deployed program, the same split the built-in devnode e2e
suites use:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestClient, http } from '@provablehq/veil-core'
import type { PublicClient, WalletClient, TestClient, LocalAccount } from '@provablehq/veil-core'
import { devnodeActions, DEVNODE_PRIVATE_KEY, type DevnodeInstance } from '@provablehq/veil-aleo-devnode'
import { leoActions } from '@provablehq/veil-leo'
import { createDevnodeClient } from '@provablehq/veil-aleo-sdk'

const PROGRAM_ID = 'points_demo.aleo'

describe('points_demo.aleo', () => {
  let devnode: DevnodeInstance
  let testClient: TestClient
  let publicClient: PublicClient
  let walletClient: WalletClient
  let account: LocalAccount<'privateKey'>

  beforeAll(async () => {
    // Built locally with its full extended type so `.startDevnode` and `.leo`
    // are available here; only the base `TestClient` surface is needed once
    // setup is done, so `testClient` below narrows to that for the rest of
    // the suite.
    const client = createTestClient({
      transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
    })
      .extend(devnodeActions)
      .extend(leoActions({
        cwd: './programs/points_demo',
        network: 'testnet',
        endpoint: 'http://127.0.0.1:3030',
        privateKey: DEVNODE_PRIVATE_KEY,
      }))

    devnode = await client.startDevnode({ readyTimeout: 45_000 })
    ;({ publicClient, walletClient, account } = createDevnodeClient())

    await client.leo.build()
    await client.leo.deploy({ broadcast: true, yes: true })
    await client.advanceBlock({ count: 1 }) // confirm the deployment

    const source = await publicClient.getCode({ programId: PROGRAM_ID })
    expect(source).toContain(`program ${PROGRAM_ID}`)

    testClient = client
  }, 180_000)

  afterAll(async () => {
    await testClient.shutdown().catch(() => {})
    await devnode.stop()
  }, 60_000)

  it('writeContract executes and the finalize write lands in the mapping', async () => {
    const txId = await walletClient.writeContract({
      program: PROGRAM_ID,
      function: 'earn_points',
      inputs: [account.address, '10u64'],
    })
    await testClient.advanceBlock({ count: 1 })

    const { status } = await walletClient.transactionStatus({ transactionId: txId })
    expect(status).toBe('accepted')

    const balance = await publicClient.readContract({
      programId: PROGRAM_ID,
      mapping: 'points',
      key: account.address,
    })
    expect(balance).toBe('10u64')
  }, 120_000)

  it('executeContract returns the transition outputs directly', async () => {
    // A pure function — no mapping write, so no `advanceBlock` beforehand is
    // needed; `executeContract` itself waits for confirmation.
    const { transactionId, outputs } = await walletClient.executeContract({
      program: PROGRAM_ID,
      function: 'double_points',
      inputs: ['50u64'],
    })
    expect(transactionId).toMatch(/^at1/)
    expect(outputs).toEqual(['100u64'])
  }, 120_000)
})
```

`writeContract` only confirms once `advanceBlock` mines the block carrying
it — the devnode auto-mines after every broadcast by default, so this line
matters only under `manualBlockCreation`; it is included here because a
suite that turns that on later should not have to hunt down every missing
`advanceBlock` call. `executeContract` waits for confirmation on its own and
needs no `advanceBlock` alongside it. See
[`writeContract`](/api/wallet/writeContract),
[`executeContract`](/api/wallet/executeContract), and
[`transactionStatus`](/api/wallet/transactionStatus) for the full option and
return shapes, and [Local Devnode](/guides/devnode) for the conceptual
walkthrough of starting, driving, and building against a devnode.

## Resetting state between test files

`restoreDevnode` requires the devnode already stopped — restoring rewrites
the storage directory on disk, which the running process still holds open —
so a snapshot/restore round trip fits between whole test files, not between
individual `it` blocks inside one `beforeAll`/`afterAll` pair. A suite whose
compile-and-deploy step dominates its runtime can deploy and snapshot once,
then have every other test file restore that baseline instead of repeating
it:

```ts
// One-time setup: deploy against persistent storage, then snapshot it.
import { createTestClient, http } from '@provablehq/veil-core'
import { devnodeActions, DEVNODE_PRIVATE_KEY } from '@provablehq/veil-aleo-devnode'
import { leoActions } from '@provablehq/veil-leo'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})
  .extend(devnodeActions)
  .extend(leoActions({
    cwd: './programs/points_demo',
    network: 'testnet',
    endpoint: 'http://127.0.0.1:3030',
    privateKey: DEVNODE_PRIVATE_KEY,
  }))

const devnode = await client.startDevnode({ storagePath: '' }) // '' -> ./devnode
await client.leo.build()
await client.leo.deploy({ broadcast: true, yes: true })
await client.advanceBlock({ count: 1 })
await client.snapshot({ name: 'after-deploy' })

await client.shutdown()
await devnode.stop()
```

```ts
// Each test file's beforeAll: restore the baseline instead of redeploying.
import { restoreDevnode, startDevnode } from '@provablehq/veil-aleo-devnode'

await restoreDevnode({ snapshot: 'after-deploy', storage: './devnode' })
const devnode = await startDevnode({ storagePath: './devnode' })
// ...call createDevnodeClient() / attach a test client and run assertions...
```

`restoreDevnode` only rewrites storage; it does not start the node back up
unless `restart: true` is passed along with `privateKey` — starting it as a
separate `startDevnode` call, as above, keeps the two steps independently
retryable if either one fails. See [`restoreDevnode`](/api/devnode/restoreDevnode)
and [`snapshot`](/api/test/snapshot) for the full option lists.

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
