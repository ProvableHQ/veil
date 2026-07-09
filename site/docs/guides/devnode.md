---
sidebar_position: 6
---

# Devnode + Leo

`@veil/devnode` spawns and controls a local [`aleo-devnode`](https://github.com/ProvableHQ/snarkvm-aleo) — a single-validator Aleo node that bypasses consensus and skips ZK proof generation, so program iteration is fast (sub-second build/deploy/execute cycles).

`@veil/leo` is a programmatic wrapper around the `leo` CLI (build, abi, deploy, synthesize). It is independent of the network — you can `.extend(leoActions(...))` onto any veil client.

> Both packages assume the underlying binaries (`aleo-devnode`, `leo`) are installed and on your `PATH`.

## Quickest path — `createDevnodeClient()`

```ts
import { createDevnodeClient } from '@veil/provable-sdk'

const { publicClient, walletClient, account } = createDevnodeClient()
```

This returns a wallet client whose `proving` config uses `mode: 'devnode'` — the WASM layer builds execution/deployment transactions that the local devnode can accept without consensus. The seeded `DEVNODE_PRIVATE_KEY` is pre-funded.

Override the seeded key or socket address if you need to:

```ts
const { publicClient, walletClient } = createDevnodeClient({
  privateKey: 'APrivateKey1...',
  socketAddr: '127.0.0.1:4040',
})
```

## Spawning a devnode

```ts
import { createTestClient, http } from '@veil/core'
import { devnodeActions, DEVNODE_ADDR } from '@veil/devnode'

const testClient = createTestClient({
  transport: http(`http://${DEVNODE_ADDR}`, { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await testClient.startDevnode({
  // Defaults shown for clarity
  socketAddr: DEVNODE_ADDR,
  verbosity: 2,
  readyTimeout: 30_000,
  // storagePath: ''          // omit for in-memory; '' for default './devnode'; string for custom dir
  // manualBlockCreation: true // disables auto-block creation; then call testClient.advanceBlock()
})

// ... do stuff ...

await devnode.stop()
```

## End-to-end loop

Build with Leo, deploy via the wallet client, then run a function and read outputs back — all against a process you spawned a moment ago.

```ts
import { createTestClient, http } from '@veil/core'
import { devnodeActions, DEVNODE_ADDR } from '@veil/devnode'
import { leoActions } from '@veil/leo'
import { createDevnodeClient } from '@veil/provable-sdk'
import { readFile } from 'node:fs/promises'

// 1. Spawn devnode
const tc = createTestClient({
  transport: http(`http://${DEVNODE_ADDR}`, { network: 'testnet' }),
})
  .extend(devnodeActions)
  .extend(leoActions({ cwd: './my-program', network: 'testnet' }))

const devnode = await tc.startDevnode()

// 2. Build with Leo (leo ≥4.3 writes build/<name>/<name>.aleo)
await tc.leo.build()
const source = await readFile('./my-program/build/my_program/my_program.aleo', 'utf8')

// 3. Get a wired client pair pointing at the devnode
const { publicClient, walletClient } = createDevnodeClient()

// 4. Deploy — the devnode needs one block before the first deploy
await tc.advanceBlock({ count: 1 })
const deployTx = await walletClient.deployContract({ program: source })

// 5. Execute and read outputs
const { transactionId, outputs } = await walletClient.executeContract({
  program: 'my_program.aleo',
  function: 'main',
  inputs: ['10u32', '20u32'],
})

await devnode.stop()
```

## Restoring a snapshot

```ts
import { restoreDevnode } from '@veil/devnode'

await restoreDevnode({
  snapshot: 'after-token-deploy',
  storage: './devnode-storage',
  restart: true,
  privateKey: 'APrivateKey1...',
})
```

## When to use what

| Need | Reach for |
|---|---|
| Fastest possible local loop, no Leo CLI involvement | `createDevnodeClient()` |
| Compile / synthesize / deploy with Leo from Node | `leoActions(...)` extension |
| Spawn / advance / restore a devnode programmatically | `devnodeActions` extension |
| One-line client pair for an already-running devnode | `createDevnodeClient({ socketAddr })` |
