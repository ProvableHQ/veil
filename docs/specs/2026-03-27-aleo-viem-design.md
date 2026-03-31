# aleo-viem Design Spec

A viem-like TypeScript interface for the Aleo blockchain. Wraps existing Aleo wallets and SDKs behind a unified, familiar API surface.

## Goals

- Viem developers can interact with Aleo using patterns they already know
- Interface-first: core depends on interfaces, not specific SDK implementations
- Any wallet, SDK, or service can plug in by implementing the interfaces
- Use viem method names wherever the concept maps; Aleo-native names only for concepts with no EVM equivalent

## Non-Goals

- No Leo compiler — users bring compiled programs
- No proof generation implementation — delegated to proving implementations
- No record indexing — delegated to record scanning implementations
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
│                                                      │
│     Contract Instances (getContract)                 │
│  Binds program + client(s), provides typed           │
│  read/write methods from parsed program source       │
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
│              Client Configuration                    │
│                                                      │
│  proving: { mode, url, apiKey, buildTransaction? }   │
│  records: config object or custom implementation     │
│                                                      │
│  Wallets handle both internally by default.          │
│  SDK/local users configure explicitly.               │
│  Proving config excluded from type for RPC accounts. │
├─────────────────────────────────────────────────────┤
│         Aleo Network (REST API / Wallet)             │
└─────────────────────────────────────────────────────┘
```

## Core Interfaces

aleo-viem defines interfaces. Implementations plug in. No `Aleo` prefix on types — use import namespacing to avoid collisions.

### Transport

```ts
interface Transport {
  request(method: string, params?: unknown): Promise<unknown>
}
```

Reference implementations: `http(url)`, `custom(provider)`, `fallback([...transports])`.

### Account

```ts
// Common base — address only, no sensitive material
interface Account {
  address: string        // aleo1...
}

// Can sign — either locally or via RPC
interface SignerAccount extends Account {
  sign(message: Uint8Array): Promise<Uint8Array>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

// Signing happens locally — has private key material
interface LocalAccount extends SignerAccount {
  type: 'local'
  privateKey: string
  viewKey: string
}

// Signing delegated externally (wallet)
interface RpcAccount extends SignerAccount {
  type: 'rpc'
}

// Read and decrypt only — cannot sign, cannot build transactions
interface ViewOnlyAccount extends Account {
  type: 'viewOnly'
  viewKey: string
}
```

Account type describes capabilities, not origin. A wallet can return any type.

`viewKey` is only present on `LocalAccount` (has full key material) and `ViewOnlyAccount` (exists solely to decrypt). It is never on the base `Account` interface.

If an account is not a `SignerAccount`, no transactions can be built with it. TypeScript enforces this — `WalletClient` requires a `SignerAccount`.

### Contract Instance (getContract)

```ts
const contract = getContract({
  program: 'my_program.aleo',
  client: publicClient,
  // or: client: walletClient,
  // or: client: { public: publicClient, wallet: walletClient },
})

// Read a mapping value — typed from parsed program source
const balance = await contract.read.balances({ key: 'aleo1...' })

// Execute a transition — typed from parsed program source
const txId = await contract.write.transfer({ inputs: ['aleo1...', '100u64'] })
```

`getContract` binds a program identifier and client(s), returning an object with typed `read` and `write` methods derived from parsing the program source. Which methods are available depends on which client(s) are provided (public enables `read`, wallet enables `write`, both enables both).

Program source is parsed to generate typed method signatures. This gives developers autocomplete and type checking for program functions and mappings.

### RecordScanner

Records can be configured via a config object for common cases, or by passing a custom implementation for advanced use cases:

```ts
// Config object — common cases
records: { mode: 'network', url: '...' }
records: { mode: 'local' }

// Custom implementation — advanced use cases
records: { getRecords: async (params: RecordSearchParams) => AleoRecord[] }
```

Optional. Wallets typically manage record state internally. Only needed for SDK/local account users.

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

### Wallet Actions (account required — must be SignerAccount)

| Method | Aleo Operation |
|--------|---------------|
| `sendTransaction` | Submit an already-built transaction |
| `writeContract` | Execute a program transition (alias: `executeTransaction`) |
| `deployContract` | Deploy a program to the network |
| `signMessage` | Sign an arbitrary message |
| `transfer` | Convenience wrapper for credits.aleo transfers |
| `decrypt` | Decrypt a ciphertext (Aleo-native) |
| `requestRecords` | Request records from wallet/scanner (Aleo-native) |

`writeContract` is the primary name for viem familiarity. `executeTransaction` is provided as an alias for consistency with Aleo wallet adapter terminology. Both call the same implementation.

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

// Wallet — via RPC account (wallet handles proving internally)
// No proving config accepted — type excludes it for RPC accounts
const walletClient = createWalletClient({
  account: rpcAccount(walletAdapter),
  transport: custom(walletAdapter),
})

// Wallet — local account (must configure proving)
const walletClient = createWalletClient({
  account: privateKeyToAccount('APrivateKey1...'),
  transport: http('https://api.provable.com/v2'),
  proving: {
    mode: 'delegated',
    url: '...',
    apiKey: '...',
  },
  records: { mode: 'network', url: '...' },
})

// Write operations — same API regardless of account type
// Proving is handled internally based on client config
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
  fee: 1000n,
})

// Same thing using the alias
const txId = await walletClient.executeTransaction({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
  fee: 1000n,
})

const txId = await walletClient.deployContract({
  program: myProgramSource,
  fee: 5000n,
})

// Contract instance — typed convenience
const contract = getContract({
  program: 'my_program.aleo',
  client: { public: publicClient, wallet: walletClient },
})
await contract.read.balances({ key: 'aleo1...' })
await contract.write.transfer({ inputs: ['aleo1...', '100u64'] })
```

### Proving Configuration

Proving is a client-level configuration concern, not a separate provider. The `writeContract`/`executeTransaction` action handles proving internally based on the client's config.

| Account Type | Proving Behavior |
|---|---|
| `RpcAccount` | Wallet handles proving internally. `proving` config is excluded from the type — dapps cannot override user's wallet preference. |
| `LocalAccount` | Must provide `proving` config. Supports `mode: 'delegated'` (remote proving service) or `mode: 'local'` (local WASM proving). |
| `ViewOnlyAccount` | Cannot build transactions. Write actions are excluded at the type level. |

```ts
// Proving config shape
interface ProvingConfig {
  mode: 'delegated' | 'local'
  url?: string                    // Required for delegated
  apiKey?: string                 // Optional for delegated
  buildTransaction?: (options: BuildTransactionOptions) => Promise<Transaction>  // Optional override
}
```

The optional `buildTransaction` override is an escape hatch for custom proving implementations that don't fit the delegated/local model.

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
│   │   │   ├── contract/      # getContract, program parsing
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
6. **Type safety from program source** — parse Aleo programs to generate typed contract interfaces
7. **Proving is configuration, not a provider** — proving strategy is a client config concern, not a separate abstraction
