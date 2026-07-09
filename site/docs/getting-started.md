---
sidebar_position: 2
---

# Getting Started

## Installation

```bash
npm install @provablehq/veil-core
```

For React apps:
```bash
npm install @provablehq/veil-core @provablehq/veil-react
```

For server-side / Node.js:
```bash
npm install @provablehq/veil-core @provablehq/veil-sdk
```

## Quick Start — Read Chain State

No wallet needed. Create a public client and start reading.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

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
import { VeilProvider, useVeilWallet } from '@provablehq/veil-react'

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

Use `@provablehq/veil-sdk` for local key management without a browser wallet.

```ts
import { createPublicClient, createWalletClient, http } from '@provablehq/veil-core'
import {
  privateKeyToAccount,
  createProvingConfig,
  createLocalScanner,
} from '@provablehq/veil-sdk'

const transport = http('https://api.provable.com/v2', { network: 'testnet' })

// Public client for reads
const publicClient = createPublicClient({ transport })

// Local account from private key
const account = privateKeyToAccount('APrivateKey1...')

// Wallet client with local proving + record scanning
const walletClient = createWalletClient({
  account,
  transport,
  proving: createProvingConfig({ mode: 'delegated' }),
  recordProvider: createLocalScanner({
    url: 'https://api.provable.com/v2',
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

## Next Steps

- [Public Client](/clients/public-client) — All read actions
- [Wallet Client](/clients/wallet-client) — Writing to the chain
- [React Integration](/react/overview) — VeilProvider and hooks
- [Working with Records](/guides/working-with-records) — Private state on Aleo
