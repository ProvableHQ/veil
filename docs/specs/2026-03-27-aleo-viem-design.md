# aleo-viem Design Spec

A viem-like TypeScript interface for the Aleo blockchain. Wraps existing Aleo wallets and SDKs behind a unified, familiar API surface.

## Goals

- Viem developers can interact with Aleo using patterns they already know
- Interface-first: core depends on interfaces, not specific SDK implementations
- Any wallet, SDK, or service can plug in by implementing the interfaces
- Use viem method names wherever the concept maps; Aleo-native names only for concepts with no EVM equivalent

## Non-Goals

- No Leo compiler — users bring compiled programs
- No proof generation implementation — delegated to prover implementations
- No record indexing — delegated to record scanner implementations
- No wallet UI or connect modals — that's a layer above
- No React hooks in core — future `@aleo-viem/react` package

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  User Application                    │
├─────────────────────────────────────────────────────┤
│                     Clients                          │
│  ┌─────────────────────┬──────────────────────────┐ │
│  │ PublicClient         │ WalletClient             │ │
│  │ (read-only)          │ (sign, execute, deploy)  │ │
│  └────────┬─────────────┴───────────┬──────────────┘ │
│           │                         │                │
│     Public Actions            Wallet Actions         │
│  getBlock, getTransaction   writeContract            │
│  getBalance, getCode        deployContract           │
│  readContract, estimateGas  sendTransaction          │
│  getBlockNumber             signMessage              │
│  getRecords                 transfer, decrypt        │
│  getTransitionViewKeys      requestRecords           │
├─────────────────────────────────────────────────────┤
│                   Account Layer                      │
│                                                      │
│  Accounts describe capabilities, not origin.         │
│  A wallet can produce any account type.              │
│                                                      │
│  ┌───────────────┬──────────────┬─────────────────┐ │
│  │ RpcAccount    │ LocalAccount │ ViewOnlyAccount │ │
│  │ (signing      │ (has private │ (has view key,  │ │
│  │  delegated    │  key, signs  │  can decrypt,   │ │
│  │  externally)  │  locally)    │  cannot sign)   │ │
│  └───────────────┴──────────────┴─────────────────┘ │
│                                                      │
│  LocalAccount creation:                              │
│    privateKeyToAccount('APrivateKey1...')             │
│    mnemonicToAccount('word word ...')                 │
├─────────────────────────────────────────────────────┤
│                  Transport Layer                     │
│  ┌──────────┬───────────┬──────────────────────────┐ │
│  │ http()   │ custom()  │ fallback([...])          │ │
│  │ (Aleo    │ (wallet   │ (chain multiple          │ │
│  │  REST    │  adapter  │  transports)             │ │
│  │  API)    │  or any)  │                          │ │
│  └──────────┴───────────┴──────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│              Optional Providers                      │
│  ┌─────────────────────┬──────────────────────────┐ │
│  │ Prover              │ RecordScanner            │ │
│  │ delegated() | local()│ network() | local()     │ │
│  └─────────────────────┴──────────────────────────┘ │
│                                                      │
│  Optional, overridable. Wallets handle internally    │
│  by default. SDK users configure explicitly.         │
│  Implementors can provide their own.                 │
├─────────────────────────────────────────────────────┤
│         Aleo Network (REST API / Wallet)             │
└─────────────────────────────────────────────────────┘
```

## Core Interfaces

aleo-viem defines interfaces. Implementations plug in.

### Transport

```ts
interface AleoTransport {
  request(method: string, params?: unknown): Promise<unknown>
}
```

Reference implementations: `http(url)`, `custom(provider)`, `fallback([...transports])`.

### Account

```ts
// Common base
interface AleoAccount {
  address: string        // aleo1...
  viewKey?: string       // AViewKey1... (optional, not all accounts expose this)
}

// Can sign — either locally or via RPC
interface AleoSignableAccount extends AleoAccount {
  sign(message: Uint8Array): Promise<Uint8Array>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

// Signing happens locally — has private key material
interface AleoLocalAccount extends AleoSignableAccount {
  type: 'local'
  privateKey: string
  viewKey: string
}

// Signing delegated externally
interface AleoRpcAccount extends AleoSignableAccount {
  type: 'rpc'
}

// Read and decrypt only
interface AleoViewOnlyAccount extends AleoAccount {
  type: 'viewOnly'
  viewKey: string
}
```

Account type describes capabilities, not origin. A wallet can return any type.

### Prover

```ts
interface AleoProver {
  buildTransaction(options: BuildTransactionOptions): Promise<AleoTransaction>
}
```

Reference implementations: `delegated({ url, apiKey })`, `local()`.

Optional. Wallets typically handle proving internally. Required for LocalAccount users who need to build transactions directly.

### RecordScanner

```ts
interface AleoRecordScanner {
  getRecords(params: RecordSearchParams): Promise<AleoRecord[]>
}
```

Reference implementations: `networkScanner({ url })`, `localScanner()`.

Optional. Wallets typically manage record state internally.

## Actions

### Naming Rule

If viem has a name for the concept, use it. Only invent names for Aleo-specific concepts with no EVM equivalent.

### Public Actions (no account required)

| Method | Aleo Operation |
|--------|---------------|
| `getBlock` | Fetch block by height or hash |
| `getBlockNumber` | Current chain height |
| `getTransaction` | Fetch transaction by ID |
| `getBalance` | Public credits balance for an address |
| `readContract` | Read a program's public mapping value |
| `getCode` | Fetch program source code |
| `estimateGas` | Estimate execution/deployment fee |
| `getRecords` | Fetch records for a program (Aleo-native) |
| `getTransitionViewKeys` | Get transition view keys for a transaction (Aleo-native) |

### Wallet Actions (account required)

| Method | Aleo Operation |
|--------|---------------|
| `sendTransaction` | Submit an already-built transaction |
| `writeContract` | Execute a program transition |
| `deployContract` | Deploy a program to the network |
| `signMessage` | Sign an arbitrary message |
| `transfer` | Convenience wrapper for credits.aleo transfers |
| `decrypt` | Decrypt a ciphertext (Aleo-native) |
| `requestRecords` | Request records from wallet/scanner (Aleo-native) |

## Client Creation API

```ts
// Read-only — no account needed
const publicClient = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

const height = await publicClient.getBlockNumber()
const balance = await publicClient.getBalance({ address: 'aleo1...' })
const value = await publicClient.readContract({
  program: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})

// Wallet — via RPC account (signing delegated)
const walletClient = createWalletClient({
  account: rpcAccount(walletAdapter),
  transport: custom(walletAdapter),
})

// Wallet — local account (signing local)
const walletClient = createWalletClient({
  account: privateKeyToAccount('APrivateKey1...'),
  transport: http('https://api.provable.com/v2'),
  prover: delegated({ url: '...', apiKey: '...' }),
  records: networkScanner({ url: '...' }),
})

// Write operations — same API regardless of account type
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
  fee: 1000n,
})

const txId = await walletClient.deployContract({
  program: myProgramSource,
  fee: 5000n,
})
```

## Cryptographic Primitives

aleo-viem will expose cryptographic primitives as interfaces, surfacing the underlying SDK's capabilities through a consistent API. Advanced users can access hashing, signing, field/group operations, and record encryption/decryption directly.

The cryptographic primitives interface will be fleshed out more in the future.

## Package Structure

```
aleo-viem/
├── packages/
│   ├── core/                  # @aleo-viem/core
│   │   ├── src/
│   │   │   ├── clients/       # createPublicClient, createWalletClient
│   │   │   ├── accounts/      # LocalAccount, RpcAccount, ViewOnlyAccount
│   │   │   ├── transports/    # http, custom, fallback
│   │   │   ├── actions/       # public/ and wallet/ actions
│   │   │   ├── types/         # core type definitions
│   │   │   └── utils/         # encoding, address validation
│   │   └── package.json
│   ├── react/                 # @aleo-viem/react (future)
│   └── mobile/                # @aleo-viem/mobile (future)
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

Core has zero hard dependencies on any specific SDK. Adapters for wallets/SDKs are either optional imports or separate packages, depending on dependency weight.

## Underlying Ecosystem

aleo-viem wraps and unifies these existing tools:

- **Aleo Wallet Adapter** (`@provablehq/aleo-wallet-standard`) — standard interface for all Aleo wallets (Leo, Puzzle, Fox, Shield Mobile Wallet)
- **@provablehq/sdk** — WASM-based Aleo SDK for browser/node environments
- **shield-mobile-sdk** — native Aleo SDK for React Native environments

Any of these can back any interface. The wallet adapter can produce RpcAccounts or LocalAccounts. Either SDK can back local signing, proving, or record scanning. aleo-viem is agnostic — it only cares about the interface contract.

## Design Principles

1. **Interface-first** — core depends on interfaces, implementations plug in
2. **Viem naming** — use viem's method names wherever the concept maps
3. **Accounts describe capabilities, not origin** — a wallet can produce any account type
4. **Convention over configuration** — sensible defaults, everything overridable
5. **Aim for full abstraction, accept pragmatism where forced** — don't invent bad metaphors for Aleo concepts that have no EVM equivalent
