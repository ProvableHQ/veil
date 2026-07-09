---
sidebar_position: 2
---

# Getting Started

## Installation

Every setup starts with the base package.

```bash
npm install @provablehq/veil-core
```

A browser dApp adds the React hooks package, which pulls in the wallet
adapter bridge:

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-react-hooks
```

A Node process holding its own private key adds the local-signing package
instead, which pulls in `@provablehq/sdk`:

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-sdk
```

A read-only integration — an explorer, an indexer, a price feed — needs
only `@provablehq/veil-core`; no account or signing package is required.

## Read-only client

Create a public client and start reading. No account, wallet, or private
key is involved anywhere in this path.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

// Current chain height
const height = await client.getBlockNumber()

// Public credits balance
const balance = await client.getBalance({
  address: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})

// A program mapping value — Aleo's public key/value storage
const raw = await client.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
```

## Browser dApp with a connected wallet

`VeilProvider` auto-configures every known Aleo wallet adapter (Shield, Leo,
Puzzle, Fox) and `useVeilWallet` returns a public client that works
immediately and a wallet client that becomes available once the user
connects.

```tsx
import { VeilProvider, useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

function Root() {
  return (
    <VeilProvider network="testnet" programs={['my_program.aleo']}>
      <App />
    </VeilProvider>
  )
}

function App() {
  const { publicClient, walletClient, address, connect } = useVeilWallet()

  async function checkBalance() {
    // Reads work before a wallet connects.
    return publicClient.getBalance({ address: 'aleo1...' })
  }

  async function sendTransfer() {
    // Writes require a connected wallet — walletClient is undefined until then.
    if (!walletClient) return
    return walletClient.writeContract({
      program: 'my_program.aleo',
      function: 'transfer',
      inputs: ['aleo1...', '100u64'],
    })
  }

  return (
    <div>
      {address ? address : <button onClick={() => connect('Shield Wallet')}>Connect</button>}
    </div>
  )
}
```

`programs` declares which programs the dApp calls; wallets like Shield
require it at connection time and reject calls to programs not listed there.

## Node process with a local private key

`loadNetwork` loads the Aleo WASM binaries for one network and returns a
handle carrying account derivation and proving configuration bound to it.
The handle's `privateKeyToAccount` and `createProvingConfig` build the
pieces a wallet client needs to sign, prove, and broadcast without a
browser wallet in the loop.

```ts
import { createPublicClient, createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const transport = http('https://api.provable.com/v2', { network: 'testnet' })

// Public client for reads — same interface as the read-only path above.
const publicClient = createPublicClient({ transport })

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const walletClient = createWalletClient({
  account,
  transport,
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl: 'https://api.provable.com/v2',
    proverUrl: 'https://api.provable.com',
    consumerId: '<consumer-id>',
    apiKey: '<api-key>',
    account,
  }),
})

const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
})
```

`mode: 'delegated'` sends the proving work to a remote prover at
`proverUrl` instead of proving in-process; pass `mode: 'local'` to prove
with the handle's own WASM binaries instead, dropping `proverUrl`,
`consumerId`, and `apiKey`. `consumerId` and `apiKey` authenticate against
the delegated prover and come from registering with the Provable API — see
the "Registering with the Provable API" section of the repository's
`AGENTS.md` for the one-time registration call.

## Next steps

- [`getBalance`](/api/public/getBalance) and the rest of the [Public Client](/clients/public-client) — every read action.
- [`writeContract`](/api/wallet/writeContract) and the [Wallet Client](/clients/wallet-client) — signing, deploying, and transferring.
- [React Integration](/react/overview) — `VeilProvider` and `useVeilWallet` in full.
- [Working with records](/guides/working-with-records) — Aleo's private state model and how it flows into program inputs.
- [Test Client](/clients/test-client) and [Local devnode](/guides/devnode) — running against a local Aleo node instead of the public API.
