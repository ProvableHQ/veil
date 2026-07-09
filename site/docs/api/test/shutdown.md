# shutdown

Asks a local devnode to stop accepting work and exit.

Applies in test teardown so the node's port is free for the next run. Hits
the devnode over the transport; the process exits shortly after the request
is acknowledged, so subsequent requests on this client fail.

## Usage

```ts
import { createTestClient, http } from '@provablehq/veil-core'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})

await client.shutdown()
```

## Returns

`void`

Resolves once the devnode has acknowledged the shutdown request.
