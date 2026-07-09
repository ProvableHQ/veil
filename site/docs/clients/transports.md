---
sidebar_position: 3
---

# Transports

Transports define how veil communicates with the Aleo network. Every client requires a transport.

## HTTP Transport

Connects to an Aleo RPC endpoint via REST.

```ts
import { http } from '@provablehq/veil-core'

const transport = http('https://api.provable.com/v2', {
  network: 'mainnet', // or 'testnet'
})
```

## Custom Transport

Wrap any request function as a transport.

```ts
import { custom } from '@provablehq/veil-core'

const transport = custom({
  request: async ({ method, params }) => {
    // Your custom logic
  },
})
```

## Fallback Transport

Try multiple transports in order. First success wins.

```ts
import { fallback, http } from '@provablehq/veil-core'
import { transportFromAdapter } from '@provablehq/veil-wallet-adapter'

const transport = fallback([
  transportFromAdapter(walletAdapter), // Try wallet first
  http('https://api.provable.com/v2'),  // Fall back to RPC
])
```

This is commonly used with wallet clients — the wallet transport handles write operations, and the HTTP transport handles reads.
