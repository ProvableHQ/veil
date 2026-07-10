---
sidebar_position: 3
---

# restoreDevnode

Restores a devnode ledger from a named snapshot.

Spawns `aleo-devnode restore` as a child process, so `aleo-devnode` MUST be
installed and on `PATH`. Restoring requires persistent storage — the snapshot
must have been taken from a devnode that was started with `storagePath`, since
an in-memory node has nothing to snapshot. With `restart: true` the devnode is
relaunched on the restored ledger; otherwise only the storage directory is
rewritten and the caller starts the node separately.

Taking a snapshot itself is a live REST call against a running node rather
than an `aleo-devnode` subcommand, so it is not part of this package.

## Usage

```ts
import { restoreDevnode } from '@provablehq/veil-aleo-devnode'

await restoreDevnode({
  snapshot: 'before-deploy',
  restart: true,
  socketAddr: '127.0.0.1:3030',
})
```

## Returns

`Promise<void>`

Resolves once `aleo-devnode restore` (and, when `restart` is set, the
relaunched node) is ready.

## Parameters

### options

- **Type:** `DevnodeRestoreOptions`

#### options.snapshot

- **Type:** `string`

Name of the snapshot to restore (`--snapshot`). Required.

#### options.storage

- **Type:** `string`
- **Default:** `'devnode'`

Ledger storage directory to restore into (`--storage`).

#### options.restart

- **Type:** `boolean`
- **Default:** `false`

Restarts the devnode after restoring (`--restart`).

#### options.privateKey

- **Type:** `string`

Private key used for block creation after restart. Required when `restart` is
`true`, unless set via the `$PRIVATE_KEY` environment variable.

#### options.socketAddr

- **Type:** `string`

REST API bind address, forwarded to `start` when `restart` is `true`.

#### options.verbosity

- **Type:** `0 | 1 | 2`

Log verbosity, forwarded to `start` when `restart` is `true`.

#### options.manualBlockCreation

- **Type:** `boolean`
- **Default:** `false`

Disables automatic block creation after restart, forwarded to `start` when
`restart` is `true`.

#### options.devnodePath

- **Type:** `string`
- **Default:** `'aleo-devnode'`

Path to the `aleo-devnode` binary, resolved on `PATH` by default.

## Errors

Rejects if the binary is missing, the named snapshot does not exist, or the
command exits non-zero.
