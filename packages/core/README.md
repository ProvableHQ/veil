# @provablehq/veil-core

The foundation of the Veil Aleo SDK: viem-style clients, transports, an
abstract account interface, and actions for reading the chain and writing to
contracts.

Core is platform-agnostic. It carries no React, no runtime globals, and no
hardcoded network or wallet. Chain access goes through a `transport`; signing
goes through an abstract `account`. Reach for it directly when you want a
typed, viem-style client to read Aleo state (blocks, transactions, program
mappings, balances) or to compose your own higher-level client. Every other
`@provablehq/veil-*` package builds on it.

## Installation

```sh
pnpm add @provablehq/veil-core
```

`@provablehq/veil-core` alone does not sign or prove. Concrete signing and proving come
from a companion package:

- **`@provablehq/veil-aleo-sdk`** — local private keys for bots, scripts, and tests.
- **`@provablehq/veil-aleo-wallet-adapter`** — a connected wallet (Shield, Leo) that holds the
  keys and proves on the user's behalf.

## Initialization

Core gives you a read-only `PublicClient` (a transport is all it needs) and a
`WalletClient` for signing. The signing account plugs in one of two ways,
depending on where the keys live.

### Local Key for Programmatic Usage (Using veil as an Aleo SDK)
Your code holds a private key (bots, scripts, servers, tests). For this path, `@provablehq/veil-aleo-sdk` is used to manage accounts, perform proving and signing, and record management.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const { publicClient, walletClient } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated', // or 'local' to prove in-process
  proverUrl: 'https://api.provable.com/prove/testnet',
})
```

### Wallets with Wallet-Custodied Keys (Web or Mobile Dapps)
A connected web or mobile wallet (Shield, Leo, Puzzle, Fox) holds a user's keys and 
performs signing, proving and record management. `@provablehq/veil-aleo-wallet-adapter` adapts it into an account, 
so the app carries no key or proving config:

```ts
import { createWalletClient, custom, rpcAccount } from '@provablehq/veil-core'

const walletClient = createWalletClient({
  account: rpcAccount(walletAdapter), // walletAdapter from @provablehq/veil-aleo-wallet-adapter
  transport: custom(walletAdapter),
})
```

### Read-Only
To simply read the chain: `createPublicClient({ transport: http(url) })`.

## Reading the chain

A public client needs only a transport. Point `http` at an Aleo node and pass
the target network; every read is a method on the client.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
})

// Latest block height.
const height = await client.getBlockNumber()

// Public credit balance for an address, in microcredits.
const balance = await client.getBalance({
  address: 'aleo1...',
})

// A program mapping value, returned as a raw Aleo literal string.
const supply = await client.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

`readContract` returns the raw literal (e.g. `"5000000u64"`). Decode it with
`parseValue` from the package's utils when you need a structured value.

## Writing to contracts

A wallet client pairs a transport with an `account` that signs and proves. Core
defines the account interface; the account instance comes from
`@provablehq/veil-aleo-sdk` or `@provablehq/veil-aleo-wallet-adapter`.

```ts
import { createWalletClient, http } from '@provablehq/veil-core'

const client = createWalletClient({
  account,                                    // from a companion package
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
})

const txId = await client.writeContract({
  program: 'my_program.aleo',
  function: 'transfer_public',
  inputs: ['aleo1...', '100u64'],
})
```

Wallet clients also carry `simulateContract`, `deployContract`, `transfer`,
`signMessage`, `requestRecords`, and `transactionStatus`, among others. Each
write action is available standalone (tree-shakeable) or as a method on the
client via the `extend()` pattern.

## What's in the box

- **Clients** — `createPublicClient`, `createWalletClient`, `createTestClient`,
  and the lower-level `createClient` they compose from.
- **Transports** — `http`, `custom`, and `fallback` for chain access.
- **Accounts** — the `Account` interface plus `rpcAccount` and `toAccount`
  helpers for adapting a signer to it.
- **Actions** — read actions (`getBlock`, `getTransaction`, `readMapping`,
  `getProgram`, staking and metrics reads, and more) and write actions
  (`writeContract`, `deployContract`, `transfer`, `sendTransaction`).
- **Contract instances** — `getContract` binds an ABI to a client for typed
  reads and writes.
- **Utils and types** — address validation, credit conversion, value and
  record parsing, and the shared types (`Block`, `Transaction`, `Program`,
  `ABI`, account and transport types) the rest of the SDK is built from.

## Extending a client

Clients follow viem's `extend()` pattern, so higher-level packages layer their
methods onto a base client:

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
}).extend((client) => ({
  async programExists(programId: string) {
    const code = await client.getCode({ programId }).catch(() => null)
    return code != null
  },
}))
```
