---
sidebar_position: 1
---

# startDevnode

Starts a local Aleo devnode and waits until its REST API answers.

Spawns the `aleo-devnode` binary as a child process, so `aleo-devnode` MUST be
installed and on `PATH` (or located via `devnodePath`). If a devnode is
already listening on the target socket, it is asked to shut down first so the
new instance can bind. The call resolves once the node serves block height,
or rejects after `readyTimeout`.

By default the node binds `127.0.0.1:3030`, keeps its ledger in memory (lost
on stop), creates blocks automatically after each broadcast, and produces
blocks with the well-known seeded key `DEVNODE_PRIVATE_KEY` (see
[devnodeActions](/api/devnode/devnodeActions) for the constant).

## Usage

```ts
import { startDevnode } from '@provablehq/veil-aleo-devnode'

const devnode = await startDevnode()
// devnode.socketAddr -> '127.0.0.1:3030'

// ...broadcast transactions against http://127.0.0.1:3030...

await devnode.stop()
```

Persistent storage and manual block timing:

```ts
import { startDevnode } from '@provablehq/veil-aleo-devnode'

const devnode = await startDevnode({
  storagePath: '',              // '' -> default ./devnode directory
  manualBlockCreation: true,    // require an explicit advanceDevnode call to mine
})
```

## Returns

`Promise<DevnodeInstance>`

An object with `socketAddr` (the address the node is listening on) and `stop`
(terminates the process gracefully with `SIGTERM`). Hold on to the instance
for the lifetime of the node — the child process is not stopped automatically
when the parent exits.

## Parameters

### options

- **Type:** `DevnodeStartOptions`
- **Default:** `undefined` — starts an ephemeral node on port 3030 with every
  other default below.

Overrides for the devnode process. Every field is optional.

#### options.privateKey

- **Type:** `string`
- **Default:** `DEVNODE_PRIVATE_KEY`

Private key used for block creation.

#### options.socketAddr

- **Type:** `string`
- **Default:** `DEVNODE_ADDR` (`'127.0.0.1:3030'`)

REST API bind address (`-a, --socket-addr`).

#### options.verbosity

- **Type:** `0 | 1 | 2`
- **Default:** `2`

Log verbosity (`-v, --verbosity`).

#### options.genesisPath

- **Type:** `string`

Path to a custom genesis block file (`-g, --genesis-path`).

#### options.storagePath

- **Type:** `string`

Directory for persistent ledger storage (`-s, --storage [DIR]`). Omit for an
in-memory, ephemeral ledger. Pass an empty string to use the default
`./devnode` directory, or a path string for a custom directory.

#### options.clearStorage

- **Type:** `boolean`
- **Default:** `false`

Clears the storage directory before starting (`-c, --clear-storage`).
Requires `storagePath`.

#### options.manualBlockCreation

- **Type:** `boolean`
- **Default:** `false`

Disables automatic block creation after a broadcast
(`-m, --manual-block-creation`). Pair with
[`advanceDevnode`](/api/devnode/advanceDevnode) for deterministic block
timing.

#### options.readyTimeout

- **Type:** `number`
- **Default:** `30000`

Milliseconds to wait for the REST API to become ready before rejecting.

#### options.devnodePath

- **Type:** `string`
- **Default:** `'aleo-devnode'`

Path to the `aleo-devnode` binary, resolved on `PATH` by default.

#### options.verbose

- **Type:** `boolean`
- **Default:** `false`

Writes devnode stdout/stderr to `devnode-<port>.log` in the current working
directory instead of discarding them.

## Errors

Rejects if the binary is missing, the process exits during startup, or the
REST API is not ready within `readyTimeout`.
