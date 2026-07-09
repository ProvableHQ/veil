---
sidebar_position: 6
---

# Testing Against a Devnode

Testing against Aleo's testnet is slow and shared: blocks take real time to
produce, funded accounts are scarce, and state left behind by other tests is
outside a suite's control. A devnode is a local Aleo node — similar to
Foundry's Anvil for Ethereum — that a test suite starts, drives, and tears
down by itself. It seeds a funded genesis account, can mine blocks on
demand instead of waiting for real block production, and its ledger can be
snapshotted and restored between test cases.

`@provablehq/veil-aleo-devnode` drives the `aleo-devnode` binary as a
subprocess; it must be installed and resolvable on `PATH`. Pair it with
`@provablehq/veil-leo` to compile and deploy the program under test onto the
node it starts.

## Quick start

For a script or a single test that needs nothing more than a working client
against a running devnode, [`createDevnodeClient`](/api/provable-sdk/createDevnodeClient)
returns a wired `publicClient`/`walletClient`/`account` triple in one call, no
`loadNetwork` required:

```ts
import { createDevnodeClient } from '@provablehq/veil-aleo-sdk'

const { publicClient, walletClient, account } = createDevnodeClient()
// account is the devnode's seeded, pre-funded key at 127.0.0.1:3030

const txId = await walletClient.writeContract({
  program: 'credits.aleo',
  function: 'transfer_public',
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

This assumes a devnode is already running at the default socket. The rest of
this guide covers starting and driving that node.

## Starting the node

[`startDevnode`](/api/devnode/startDevnode) spawns the binary and resolves
once its REST API answers, so the returned instance is ready to receive
transactions:

```ts
import { startDevnode, DEVNODE_ADDR } from '@provablehq/veil-aleo-devnode'

const devnode = await startDevnode({
  socketAddr: DEVNODE_ADDR, // '127.0.0.1:3030'
  storagePath: '',          // '' -> default ./devnode dir; omit for in-memory
})

// ...broadcast transactions against http://127.0.0.1:3030...

await devnode.stop()
```

By default the node mines a block automatically after every broadcast. Pass
`manualBlockCreation: true` for deterministic block timing instead, and mine
on demand with [`advanceDevnode`](/api/devnode/advanceDevnode):

```ts
const devnode = await startDevnode({ manualBlockCreation: true })

// ...broadcast a transaction...

await advanceDevnode({ numBlocks: 1 }) // mine a block so it can be accepted
```

## Driving the node from a test client

[`devnodeActions`](/api/devnode/devnodeActions) folds `startDevnode`,
`advanceDevnode`, and `restoreDevnode` onto a
[test client](/clients/test-client) via `.extend`, so one client both drives
the node process and, through the core test actions, reads and mutates its
state:

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { devnodeActions } from '@provablehq/veil-aleo-devnode'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await client.startDevnode({ storagePath: '' })
await client.advanceDevnode({ numBlocks: 1 })
```

`advanceBlock` is the core test action of the same shape, for a client that
already has a devnode running and only needs to move the chain forward:

```ts
await client.advanceBlock({ count: 5 }) // mines 5 blocks, one request per block
```

## Building and deploying the program under test

[`leoActions`](/api/leo/leoActions) attaches a `.leo` property to any veil
client, running the `leo` CLI against a project directory. Leo operations
need no transport, so the extension composes onto the same test client:

```ts
import { leoActions } from '@provablehq/veil-leo'
import { DEVNODE_PRIVATE_KEY } from '@provablehq/veil-aleo-devnode'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})
  .extend(devnodeActions)
  .extend(leoActions({
    cwd: './programs/loyalty_token',
    network: 'testnet',
    endpoint: 'http://127.0.0.1:3030',
    privateKey: DEVNODE_PRIVATE_KEY,
  }))

await client.startDevnode({ storagePath: '' })

// Compile the package at cwd.
await client.leo.build()

// Deploy it, broadcasting the transaction and skipping the confirmation prompt.
await client.leo.deploy({ broadcast: true, yes: true })
```

`leoActions`'s `config` sets defaults — `cwd`, `network`, `privateKey`, and
the rest — for every `.leo` call. Deploying needs a signing key; the
devnode's seeded `DEVNODE_PRIVATE_KEY` is funded from genesis and ready to
pay the deployment fee immediately.

## Snapshotting state

Taking a snapshot is a live REST call against the running node rather than an
`aleo-devnode` subcommand, so it lives on the core test client as
[`snapshot`](/api/test/snapshot) (and [`listSnapshots`](/api/test/listSnapshots)
to enumerate them), with `restoreDevnode` here to reload one. This lets a
test suite capture a point after deployment and rewind to it between cases
instead of redeploying from scratch:

```ts
const { name } = await client.snapshot({ name: 'after-deploy' })

// ...run a test that mutates state...

await client.restoreDevnode({ snapshot: name, restart: true })
```

Restoring requires the node to have been started with `storagePath` — an
in-memory node has nothing on disk to snapshot.

## Full example

```ts
import { createTestClient, http } from '@provablehq/veil-core'
import { devnodeActions, DEVNODE_PRIVATE_KEY } from '@provablehq/veil-aleo-devnode'
import { leoActions } from '@provablehq/veil-leo'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})
  .extend(devnodeActions)
  .extend(leoActions({
    cwd: './programs/loyalty_token',
    network: 'testnet',
    endpoint: 'http://127.0.0.1:3030',
    privateKey: DEVNODE_PRIVATE_KEY,
  }))

const devnode = await client.startDevnode({
  storagePath: '',
  manualBlockCreation: true,
})

await client.leo.build()
await client.leo.deploy({ broadcast: true, yes: true })
await client.advanceBlock() // confirm the deployment

const { name } = await client.snapshot({ name: 'after-deploy' })

// ...exercise the deployed program, advancing blocks as each call needs
// confirmation...

await client.restoreDevnode({ snapshot: name, restart: true })
await devnode.stop()
```
