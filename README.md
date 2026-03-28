# aleo-viem

A TypeScript interface for Aleo, inspired by [viem](https://github.com/wevm/viem). Wraps existing Aleo wallets and SDKs behind a unified, familiar API.

## Why

Aleo's developer ecosystem is fragmented across multiple SDKs and wallets, each with its own API. If you've built on Ethereum with viem, you already know how to use aleo-viem — same patterns, same method names, applied to Aleo.

```ts
import { createPublicClient, http } from '@aleo-viem/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

const height = await client.getBlockNumber()
const balance = await client.getBalance({ address: 'aleo1...' })
const value = await client.readContract({
  program: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

## Features

- **Viem-compatible API** — `getBalance`, `readContract`, `writeContract`, `deployContract`, `sendTransaction`, `signMessage`, and more
- **Interface-first** — core has zero hard dependencies on any SDK. Wallets and SDKs plug in by implementing interfaces.
- **Multiple account types** — RPC accounts (wallet adapters), local accounts (private key, mnemonic), view-only accounts
- **Pluggable transports** — `http()` for Aleo REST API, `custom()` for wallet adapters, `fallback()` for chaining
- **Optional prover and record scanner** — configure proving (delegated or local) and record scanning per client, or let wallets handle it internally

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@aleo-viem/core` | Clients, transports, accounts, actions | In development |
| `@aleo-viem/react` | React hooks (wagmi equivalent) | Planned |
| `@aleo-viem/mobile` | Shield Mobile SDK helpers | Planned |

## Quick Start

### Read-only (no account needed)

```ts
import { createPublicClient, http } from '@aleo-viem/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

// Familiar viem-style actions
const height = await client.getBlockNumber()
const block = await client.getBlock({ height: 1000 })
const tx = await client.getTransaction({ id: 'at1...' })
const balance = await client.getBalance({ address: 'aleo1...' })
const source = await client.getCode({ program: 'credits.aleo' })
const value = await client.readContract({
  program: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

### Wallet (signing delegated to wallet adapter)

```ts
import { createWalletClient, custom, rpcAccount } from '@aleo-viem/core'

const client = createWalletClient({
  account: rpcAccount(walletAdapter),
  transport: custom(walletAdapter),
})

await client.writeContract({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
  fee: 1000n,
})

await client.deployContract({
  program: myProgramSource,
  fee: 5000n,
})

await client.transfer({
  to: 'aleo1...',
  amount: 1_000_000n,
})
```

### Local account (signing with private key)

```ts
import {
  createWalletClient,
  http,
  privateKeyToAccount,
} from '@aleo-viem/core'

const client = createWalletClient({
  account: privateKeyToAccount({
    privateKey: 'APrivateKey1...',
    address: 'aleo1...',
    viewKey: 'AViewKey1...',
  }),
  transport: http('https://api.provable.com/v2'),
  prover: delegated({ url: '...', apiKey: '...' }),
  records: networkScanner({ url: '...' }),
})
```

### View-only (decrypt records, no signing)

```ts
import { createPublicClient, http, viewOnlyAccount } from '@aleo-viem/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

const account = viewOnlyAccount({
  address: 'aleo1...',
  viewKey: 'AViewKey1...',
})

// Use the view key to decrypt records without signing authority
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Your dApp                       │
├─────────────────────────────────────────────────┤
│    PublicClient          WalletClient            │
│    (read-only)           (sign + execute)        │
├─────────────────────────────────────────────────┤
│                   Actions                        │
│  getBlockNumber    writeContract                 │
│  getBalance        deployContract                │
│  readContract      sendTransaction               │
│  getCode           signMessage                   │
│  getBlock          transfer                      │
│  estimateGas       decrypt                       │
│  getRecords        requestRecords                │
├─────────────────────────────────────────────────┤
│                  Accounts                        │
│  RpcAccount     LocalAccount    ViewOnlyAccount  │
│  (wallet)       (private key)   (view key)       │
├─────────────────────────────────────────────────┤
│                 Transports                       │
│  http()         custom()        fallback()       │
├─────────────────────────────────────────────────┤
│             Optional Providers                   │
│  Prover                  RecordScanner           │
│  delegated() | local()   network() | local()     │
├─────────────────────────────────────────────────┤
│          Aleo Network / Wallet Adapter           │
└─────────────────────────────────────────────────┘
```

### Interface-first design

aleo-viem defines interfaces. Implementations plug in.

- **Transport** — any object with a `request(method, params)` function
- **Account** — describes capabilities (can sign? has private key? has view key?), not origin
- **Prover** — builds transactions (delegated proving service, local WASM, native — your choice)
- **RecordScanner** — discovers records (network scanner, local chain scan, custom indexer)

Wallets handle proving and record management internally by default. These configs are only needed when using the SDK directly — and they're always overridable.

### Supported backends

aleo-viem wraps these existing tools through its interfaces:

- **[Aleo Wallet Adapter](https://github.com/ProvableHQ/aleo-dev-toolkit/tree/master/packages/aleo-wallet-adaptor)** — Leo Wallet, Puzzle Wallet, Fox Wallet, Shield Mobile Wallet
- **[@provablehq/sdk](https://www.npmjs.com/package/@provablehq/sdk)** — WASM-based SDK for browser/node
- **[Shield Mobile SDK](https://github.com/ProvableHQ/shield-mobile-sdk)** — Native SDK for React Native

Any of these can back any interface. The wallet adapter can produce RPC or local accounts. Either SDK can back signing, proving, or record scanning. aleo-viem doesn't care what's behind the interface.

## Actions Reference

### Public Actions (no account required)

| Method | Description |
|--------|-------------|
| `getBlockNumber()` | Current chain height |
| `getBlock({ height?, hash? })` | Fetch block by height or hash |
| `getTransaction({ id })` | Fetch transaction by ID |
| `getBalance({ address })` | Public credits balance |
| `readContract({ program, mapping, key })` | Read a program mapping value |
| `getCode({ program })` | Fetch program source code |
| `estimateGas({ program, function, inputs })` | Estimate execution fee |
| `getRecords({ program })` | Fetch records (Aleo-native) |
| `getTransitionViewKeys({ transactionId })` | Get transition view keys (Aleo-native) |

### Wallet Actions (account required)

| Method | Description |
|--------|-------------|
| `sendTransaction({ transaction })` | Broadcast a built transaction |
| `writeContract({ program, function, inputs, fee })` | Execute a program transition |
| `deployContract({ program, fee })` | Deploy a program |
| `signMessage({ message })` | Sign an arbitrary message |
| `transfer({ to, amount })` | Transfer credits (convenience) |
| `decrypt({ ciphertext })` | Decrypt a ciphertext (Aleo-native) |
| `requestRecords({ program })` | Request records (Aleo-native) |

## Naming Convention

If viem has a name for the concept, aleo-viem uses it. Aleo-specific names are only used for concepts with no EVM equivalent (records, decrypt, transition view keys).

| viem concept | aleo-viem equivalent |
|---|---|
| `getBalance` | `getBalance` — reads public credits |
| `readContract` | `readContract` — reads program mapping |
| `writeContract` | `writeContract` — executes program transition |
| `deployContract` | `deployContract` — deploys program |
| `getCode` | `getCode` — fetches program source |
| `estimateGas` | `estimateGas` — estimates fee |
| `sendTransaction` | `sendTransaction` — broadcasts transaction |
| `signMessage` | `signMessage` — signs message |

## Project Structure

```
aleo-viem/
├── packages/
│   └── core/              # @aleo-viem/core
│       └── src/
│           ├── clients/   # createPublicClient, createWalletClient
│           ├── accounts/  # rpcAccount, privateKeyToAccount, etc.
│           ├── transports/# http, custom, fallback
│           ├── actions/   # public/ and wallet/ actions
│           ├── types/     # core type definitions
│           ├── errors/    # error types
│           └── utils/     # address validation, credits conversion
├── docs/
│   ├── specs/             # Design specifications
│   └── plans/             # Implementation plans
└── package.json
```

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm typecheck
```

## License

MIT
