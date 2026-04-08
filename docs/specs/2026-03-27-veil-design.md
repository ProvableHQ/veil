# veil Design Spec

A viem-like TypeScript interface for the Aleo blockchain. Wraps existing Aleo wallets and SDKs behind a unified, familiar API surface.

## Goals

- Viem developers can interact with Aleo using patterns they already know
- Interface-first: core depends on interfaces, not specific SDK implementations
- Any wallet, SDK, or service can plug in by implementing the interfaces
- Use viem method names wherever the concept maps; Aleo-native names only for concepts with no EVM equivalent
- Agent-first: every action is exposed as an MCP tool, with structured JSON output and actionable errors, updated incrementally as the library grows

## Non-Goals

- No Leo compiler — users bring compiled programs
- No proof generation implementation — delegated to proving implementations
- No record indexing — delegated to record scanning implementations
- No wallet UI or connect modals — that's a layer above
- No React hooks in core — future `@veil/react` package

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

veil defines interfaces. Implementations plug in. No `Aleo` prefix on types — use import namespacing to avoid collisions.

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

## Agent Tooling

veil is designed for two audiences equally: human developers who write code against the TypeScript library, and AI agents that either write code using viem patterns or call tools directly. Agent tooling is built incrementally — every time a new action ships in core, its corresponding MCP tool, tool schema, and structured output are shipped alongside it.

### MCP Server (`@veil/mcp`)

An MCP server exposing every veil action as a tool. This is the primary interface for tool-calling agents (Claude, GPT, autonomous DeFi agents, etc.).

Each tool has a rich description that explains the Aleo concept in terms an agent already understands from Ethereum/viem:

```json
{
  "name": "aleo_read_mapping",
  "description": "Read a value from an Aleo program's public mapping. Equivalent to viem's readContract, but Aleo programs are identified by name (e.g. 'credits.aleo') rather than address. Returns structured JSON with parsed Aleo values.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "program": { "type": "string", "description": "Program ID, e.g. 'credits.aleo'" },
      "mapping": { "type": "string", "description": "Mapping name, e.g. 'account'" },
      "key": { "type": "string", "description": "Key to look up, e.g. 'aleo1...'" }
    },
    "required": ["program", "mapping", "key"]
  }
}
```

```json
{
  "name": "aleo_execute",
  "description": "Execute a transition on an Aleo program. Equivalent to viem's writeContract. Requires a connected wallet. Returns transaction ID.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "program": { "type": "string" },
      "function": { "type": "string" },
      "inputs": { "type": "array", "items": { "type": "string" } },
      "fee": { "type": "number", "description": "Fee in microcredits" }
    },
    "required": ["program", "function", "inputs"]
  }
}
```

The MCP server wraps a configured veil client. It can be run as a standalone process or embedded in an agent framework.

### Agent Tool Schemas (`@veil/core/agent`)

Framework-agnostic agent tool definitions that any agent framework can consume. Exposed via subpath export so integrations (LangChain, Vercel AI SDK, etc.) can import and use them directly:

```ts
import { aleoAgentTools } from '@veil/core/agent'

// Returns agent tool definitions + execution handlers
const tools = aleoAgentTools({
  client: publicClient,
  walletClient: walletClient,
})
```

Each agent tool definition includes:
- Input/output JSON schemas
- Rich descriptions explaining Aleo concepts via Ethereum analogies
- Execution handler that calls the corresponding veil action

### Structured JSON Output

All actions return structured JSON rather than Aleo's native string-encoded values. Value parsing utilities convert between formats:

```ts
import { parseValue, encodeValue } from '@veil/core'

parseValue('100u64')       // → { value: 100n, type: 'u64' }
parseValue('aleo1abc...')  // → { value: 'aleo1abc...', type: 'address' }
encodeValue(100n, 'u64')   // → '100u64'
```

MCP tools and tool schemas use parsed output by default — agents receive `{ value: 100, type: "u64" }` instead of `"100u64"`.

### Program Introspection

Agents need to answer "what can I do with this program?" without reading source code. The `describeProgram` action and MCP tool return a structured description:

```ts
const description = await client.describeProgram({ program: 'token.aleo' })
// {
//   id: 'token.aleo',
//   functions: [
//     { name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'u64' }] },
//     { name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'u64' }] },
//   ],
//   mappings: [
//     { name: 'balances', keyType: 'address', valueType: 'u64' },
//   ],
// }
```

This is `getCode` + `parseProgram` combined into one call, returning structured data an agent can reason about.

### Actionable Errors

Every error message is written as an instruction an agent can act on:

```
Program "my_program.aleo" not found on mainnet.
Verify the program ID is correct and has been deployed:
  await client.getCode({ program: 'my_program.aleo' })
```

```
No account configured. To read data, use createPublicClient.
To sign transactions, use createWalletClient with an account:
  createWalletClient({ account: rpcAccount(walletAdapter), transport: custom(walletAdapter) })
```

```
Invalid input type for function 'transfer' parameter 'amount':
expected u64 (e.g. '100u64'), received '100'.
Use encodeValue(100n, 'u64') or pass '100u64' directly.
```

### Transaction Confirmation

Agents operating autonomously need to know when transactions complete. `waitForTransaction` polls until confirmed or rejected:

```ts
const txId = await walletClient.writeContract({ ... })
const result = await publicClient.waitForTransaction({ id: txId })
// { status: 'confirmed', blockHeight: 12345 }
// or: { status: 'rejected', reason: '...' }
```

Exposed as an MCP tool (`aleo_wait_for_transaction`) so autonomous agents can wait for confirmation before proceeding.

### Incremental Development

Agent tooling ships with each phase of core development:

| Core ships... | Agent tooling ships alongside... |
|---|---|
| `getBlockNumber`, `getBalance`, `readContract` | MCP tools + agent tool schemas for each, structured JSON output, `describeProgram` |
| `writeContract`, `executeTransaction` | MCP execute tool + agent tool schema, transaction confirmation tool |
| `getContract`, `parseProgram` | MCP introspection tool + agent tool schema, program description in tool metadata |
| New action | New MCP tool + agent tool schema + structured output |

The MCP server and agent tool schemas are never more than one commit behind core.

### Skills and Agent Documentation

In addition to MCP tools, veil provides skill definitions for code-writing agents (Claude Code, Cursor, Copilot). These are markdown files that explain how to use the library, with complete examples and Aleo-specific context at every decision point.

Skills are updated alongside MCP tools — when a new action ships, its skill documentation ships too.

## Cryptographic Primitives

veil will expose cryptographic primitives as interfaces, surfacing the underlying SDK's capabilities through a consistent API. Advanced users can access hashing, signing, field/group operations, and record encryption/decryption directly.

The cryptographic primitives interface will be fleshed out more in the future.

## Package Structure

```
veil/
├── packages/
│   ├── core/                  # @veil/core
│   │   ├── src/
│   │   │   ├── clients/       # createPublicClient, createWalletClient
│   │   │   ├── accounts/      # LocalAccount, RpcAccount, ViewOnlyAccount
│   │   │   ├── transports/    # http, custom, fallback
│   │   │   ├── actions/       # public/ and wallet/ actions
│   │   │   ├── contract/      # getContract, program parsing
│   │   │   ├── agent/         # Agent tool schemas + handlers (subpath: @veil/core/agent)
│   │   │   ├── mcp/           # MCP server (subpath: @veil/core/mcp)
│   │   │   ├── types/         # core type definitions
│   │   │   └── utils/         # encoding, address validation, value parsing
│   │   └── package.json
│   ├── react/                 # @veil/react (future)
│   └── mobile/                # @veil/mobile (future)
├── skills/                    # Skill definitions for code-writing agents
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

All agent tooling lives in core with subpath exports. No separate packages until the boundaries are proven:

```ts
import { createPublicClient } from '@veil/core'           // Library
import { aleoAgentTools } from '@veil/core/agent'         // Agent tool schemas + execution handlers
import { createMcpServer } from '@veil/core/mcp'          // MCP server
```

MCP SDK is a lazy/optional dependency — only loaded via the `core/mcp` subpath. Tree-shaking keeps the main entry point lean. Can be extracted into separate packages later if versioning or dependency concerns arise.

Core has zero hard dependencies on any specific SDK. Adapters for wallets/SDKs are either optional imports or separate packages, depending on dependency weight.

## Underlying Ecosystem

veil wraps and unifies these existing tools:

- **Aleo Wallet Adapter** (`@provablehq/aleo-wallet-standard`) — standard interface for all Aleo wallets (Leo, Puzzle, Fox, Shield Mobile Wallet)
- **@provablehq/sdk** — WASM-based Aleo SDK for browser/node environments
- **shield-mobile-sdk** — native Aleo SDK for React Native environments

Any of these can back any interface. The wallet adapter can produce RpcAccounts or LocalAccounts. Either SDK can back local signing, proving, or record scanning. veil is agnostic — it only cares about the interface contract.

## Design Principles

1. **Interface-first** — core depends on interfaces, implementations plug in
2. **Viem naming** — use viem's method names wherever the concept maps
3. **Accounts describe capabilities, not origin** — a wallet can produce any account type
4. **Convention over configuration** — sensible defaults, everything overridable
5. **Aim for full abstraction, accept pragmatism where forced** — don't invent bad metaphors for Aleo concepts that have no EVM equivalent
6. **Type safety from program source** — parse Aleo programs to generate typed contract interfaces
7. **Proving is configuration, not a provider** — proving strategy is a client config concern, not a separate abstraction
