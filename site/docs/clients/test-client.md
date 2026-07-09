---
sidebar_position: 4
---

# Test Client

The test client wraps a local Aleo Devnode and is the base client for `@veil/devnode` and `@veil/leo`. It exposes the same `request` / `extend` surface as the other clients, plus a small set of test-only actions.

```ts
import { createTestClient, http } from '@veil/core'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})
```

## Actions

| Action | Description |
|---|---|
| `advanceBlock({ count? })` | Advance the devnode by N blocks (default 1). Requires `--manual-block-creation`. |
| `shutdown()` | Ask the devnode to stop accepting work and exit. |
| `getMappingKeysValues({ program, mapping })` | Return all key/value pairs in a mapping. (Was previously named `getMappingContents`.) |

## Extending

The test client is designed to be composed with `@veil/devnode` and `@veil/leo`:

```ts
import { createTestClient, http } from '@veil/core'
import { devnodeActions, DEVNODE_ADDR } from '@veil/devnode'
import { leoActions } from '@veil/leo'

const client = createTestClient({
  transport: http(`http://${DEVNODE_ADDR}`, { network: 'testnet' }),
})
  .extend(devnodeActions)
  .extend(leoActions({ cwd: './my-aleo-project' }))

const devnode = await client.startDevnode()
await client.leo.build()
await client.leo.deploy({ broadcast: true, yes: true })
await client.advanceBlock()
await devnode.stop()
```

See [Devnode + Leo](/guides/devnode) for end-to-end workflows.
