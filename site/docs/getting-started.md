---
sidebar_position: 2
---

# Getting Started

## Installation

```bash
npm install @veil/core
```

For React apps:
```bash
npm install @veil/core @veil/react
```

For server-side / Node.js:
```bash
npm install @veil/core @veil/provable
```

## Quick Start — Read Chain State

No wallet needed. Create a public client and start reading.

```ts
import { createPublicClient, http } from '@veil/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

// Get the latest block height
const height = await client.getBlockNumber()

// Read a mapping value
const totalCards = await client.readMapping({
  program: 'loyalty_token.aleo',
  mapping: 'total_cards',
  key: '0field',
})

// Get an account balance (credits)
const balance = await client.getBalance({
  address: 'aleo1...',
})
```

## Quick Start — React dApp

Wrap your app in `VeilProvider`, then use the `useVeilWallet` hook anywhere.

```tsx
import { VeilProvider, useVeilWallet } from '@veil/react'

// Root — that's the entire setup
function Root() {
  return (
    <VeilProvider network="mainnet">
      <App />
    </VeilProvider>
  )
}

// Any component
function App() {
  const { publicClient, walletClient, address, connect } = useVeilWallet()

  // Read — always works
  const balance = await publicClient.getBalance({ address: 'aleo1...' })

  // Write — after wallet connects
  const txId = await walletClient.writeContract({
    program: 'my_program.aleo',
    function: 'my_function',
    inputs: ['arg1', 'arg2'],
  })
}
```

## Quick Start — Node.js / Server-Side

Use `@veil/provable` for local key management without a browser wallet. `loadNetwork` returns a network-bound handle that exposes all of the SDK-backed factories (`privateKeyToAccount`, `createProvingConfig`, scanners, `createAleoClient`).

```ts
import { loadNetwork } from '@veil/provable'

const aleo = await loadNetwork('testnet')

// One-step: fully-wired clients pointing at any network URL
const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://api.provable.com/v2',
  // Optional record provider — pass aleo.createRemoteScanner(...) to enable requestRecords
  records: aleo.createRemoteScanner({
    url: 'https://rss.provable.com',
    consumerId: 'my-app',
  }),
})

// Same interface as the React version
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['arg1', 'arg2'],
})

// Fetch records (uses the configured recordProvider)
const records = await walletClient.requestRecords({
  program: 'my_program.aleo',
})
```

For finer control, build the pieces yourself with `createPublicClient` / `createWalletClient` and `aleo.createProvingConfig({ mode: 'delegated' | 'local', ... })`.

## Quick Start — Local Devnode

For rapid iteration against a local `aleo-devnode` (no proof generation, no fees). Install the [`aleo-devnode` binary](https://github.com/ProvableHQ/snarkvm-aleo) and put it on your PATH.

```ts
import { createTestClient, http } from '@veil/core'
import { devnodeActions, DEVNODE_ADDR } from '@veil/devnode'
import { createDevnodeClient } from '@veil/provable'

// 1. Spawn a devnode using a test client decorated with @veil/devnode
const testClient = createTestClient({
  transport: http(`http://${DEVNODE_ADDR}`, { network: 'testnet' }),
}).extend(devnodeActions)

const devnode = await testClient.startDevnode()

// 2. Get a fully-wired client pair pointing at it
const { publicClient, walletClient, account } = createDevnodeClient()

// Same interface as the React/Node versions
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['arg1', 'arg2'],
})

await devnode.stop()
```

## Next Steps

- [Public Client](/clients/public-client) — All read actions
- [Wallet Client](/clients/wallet-client) — Writing to the chain
- [React Integration](/react/overview) — VeilProvider and hooks
- [Working with Records](/guides/working-with-records) — Private state on Aleo
- [Devnode + Leo](/clients/test-client) — Local devnet and CLI workflows
