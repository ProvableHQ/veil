---
sidebar_position: 2
---

# advanceDevnode

Advances a running devnode by one or more empty blocks.

Spawns `aleo-devnode advance` as a child process, so `aleo-devnode` MUST be
installed and on `PATH`. The call resolves when the subprocess exits. Applies
when the node runs with `manualBlockCreation`, or when a test needs the chain
height to move forward.

## Usage

```ts
import { startDevnode, advanceDevnode } from '@provablehq/veil-aleo-devnode'

const devnode = await startDevnode({ manualBlockCreation: true })

// ...broadcast a transaction...

await advanceDevnode({ numBlocks: 1 }) // mine a block so the broadcast can finalize

await devnode.stop()
```

## Returns

`Promise<void>`

Resolves once `aleo-devnode advance` exits with status 0.

## Parameters

### options

- **Type:** `DevnodeAdvanceOptions`
- **Default:** `undefined` — advances the default socket by one block.

#### options.numBlocks

- **Type:** `number`
- **Default:** `1`

Number of blocks to produce.

#### options.socketAddr

- **Type:** `string`
- **Default:** `DEVNODE_ADDR` (`'127.0.0.1:3030'`)

Target devnode socket (`--socket-addr`).

#### options.devnodePath

- **Type:** `string`
- **Default:** `'aleo-devnode'`

Path to the `aleo-devnode` binary, resolved on `PATH` by default.

## Errors

Rejects if the binary is missing or no devnode answers on the target socket.
