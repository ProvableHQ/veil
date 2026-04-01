# aleo-viem

A TypeScript interface for Aleo, inspired by [viem](https://github.com/wevm/viem). Wraps existing Aleo wallets and SDKs behind a unified, familiar API — for human developers and AI agents alike.

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
- **Interface-first** — core has zero hard dependencies on any SDK. Wallets and SDKs plug in via adapter packages.
- **Multiple account types** — RPC accounts (wallet adapters), local accounts (private key, mnemonic), view-only accounts
- **Pluggable transports** — `http()` for Aleo REST API, `custom()` for wallet adapters, `fallback()` for chaining
- **Contract instances** — `getContract()` parses Aleo program source and provides typed `read`/`write` methods
- **Proving as configuration** — proving strategy is a client config concern (`delegated` or `local`), not a separate abstraction
- **Agent-first** — every action ships with an MCP tool, agent tool schema, and structured JSON output. AI agents can call Aleo directly via tool use or write code against the library using viem patterns they already know.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@aleo-viem/core` | Clients, transports, accounts, actions, agent tools, MCP server | In development |
| `@aleo-viem/wallet-adapter` | Wraps `@provablehq/aleo-wallet-standard` — connects any Aleo wallet | In development |
| `@aleo-viem/provable` | Wraps `@provablehq/sdk` — key derivation, local signing, proving | In development |
| `@aleo-viem/react` | React hooks (wagmi equivalent) | Planned |
| `@aleo-viem/mobile` | Shield Mobile SDK helpers | Planned |

## Roadmap

### Q2 2026 — Core + Adapter Packages

**`@aleo-viem/core`** — zero hard dependencies
- Clients, transports, accounts, all public and wallet actions
- `getContract` + `parseProgram` for typed contract instances
- Agent tool schemas, MCP server, structured JSON output
- 2-3 example skills and dApps

**`@aleo-viem/wallet-adapter`** — wraps `@provablehq/aleo-wallet-standard`
- `rpcAccount()` and `custom()` transport for any Aleo wallet
- Validated with Leo, Puzzle, Fox, Shield wallets

**`@aleo-viem/provable`** — wraps `@provablehq/sdk`
- `privateKeyToAccount()` with key derivation
- Local signing and proving

**Q2 success criteria** — demonstrated, not measured:
- A viem developer builds a working Aleo dApp without Aleo-specific docs
- Same code works across wallets and SDKs — swap the adapter, everything else is identical
- An agent builds a working dApp first try; MCP tools work zero config

### Q3 2026 — Ecosystem Expansion

- Skills and example dApps for developer onboarding
- Agentic ecosystem integrations (Coinbase AgentKit, MPC Protocol, Near Intents)
- 3rd-party wallet integrations
- React hooks (`@aleo-viem/react`)
- Mobile SDK helpers (`@aleo-viem/mobile`)

**Q3 adoption metrics:**
- npm weekly downloads and growth rate across all packages
- Programs deployed and actively used on mainnet
- Agent tool invocations and success rate
- 3rd-party integrations shipped and their downstream usage

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

// writeContract or its alias executeTransaction
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
  proving: {
    mode: 'delegated',
    url: '...',
    apiKey: '...',
  },
  records: { mode: 'network', url: '...' },
})
```

### Contract instances

```ts
import { getContract } from '@aleo-viem/core'

const contract = getContract({
  programSource: tokenProgramSource,
  client: { public: publicClient, wallet: walletClient },
})

// Typed read/write from parsed program source
const balance = await contract.read.balances({ key: 'aleo1...' })
const txId = await contract.write.transfer({
  inputs: ['aleo1...', '100u64'],
  fee: 1000n,
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

## Agent Usage

aleo-viem is designed for two audiences equally: human developers who write code against the TypeScript library, and AI agents that either write code using viem patterns or call tools directly.

### For tool-calling agents (MCP)

Run the MCP server to expose all aleo-viem actions as tools:

```ts
import { createMcpServer } from '@aleo-viem/core/mcp'
import { createPublicClient, http } from '@aleo-viem/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

await createMcpServer({ client })
```

Agents can then call tools like `aleo_get_balance`, `aleo_read_mapping`, `aleo_execute`, `aleo_describe_program`, etc. All tools return structured JSON with parsed Aleo values.

### For tool-calling agents (framework-agnostic)

Use agent tool schemas and handlers directly in any agent framework:

```ts
import { aleoAgentTools } from '@aleo-viem/core/agent'

const tools = aleoAgentTools({
  client: publicClient,
  walletClient: walletClient,
})

// Each tool has { schema, handler } — plug into LangChain, Vercel AI SDK, etc.
```

### For code-writing agents (Claude Code, Cursor, Copilot)

Code-writing agents use the TypeScript library directly. Since it follows viem patterns, agents trained on viem can use it with minimal guidance. Key differences from viem that agents should know:

- Programs are identified by name (`'credits.aleo'`), not address
- Inputs are Aleo-encoded strings (`'100u64'`), not hex — use `encodeValue(100n, 'u64')`
- Use `describeProgram` to discover what a program can do before calling it
- `writeContract` has an alias `executeTransaction` consistent with Aleo wallet adapter terminology

### Structured output

All values are returned as structured JSON rather than Aleo's native string encoding:

```ts
import { parseValue, encodeValue } from '@aleo-viem/core'

parseValue('100u64')       // → { value: 100n, type: 'u64' }
parseValue('aleo1abc...')  // → { value: 'aleo1abc...', type: 'address' }
encodeValue(100n, 'u64')   // → '100u64'
```

### Actionable errors

Every error message is an instruction an agent can act on:

```
Program "my_program.aleo" not found. Verify the program ID is correct
and has been deployed: await client.getCode({ program: 'my_program.aleo' })
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│          Your dApp / AI Agent                    │
├─────────────────────────────────────────────────┤
│    PublicClient          WalletClient            │
│    (read-only)           (sign + execute)        │
├─────────────────────────────────────────────────┤
│                   Actions                        │
│  getBlockNumber    writeContract                 │
│  getBalance        executeTransaction (alias)    │
│  readContract      deployContract                │
│  getCode           sendTransaction               │
│  getBlock          signMessage                   │
│  estimateGas       transfer                      │
│  getRecords        decrypt                       │
│  describeProgram   requestRecords                │
├─────────────────────────────────────────────────┤
│              Contract Instances                   │
│  getContract({ programSource, client })          │
│  → contract.read.mappingName()                   │
│  → contract.write.functionName()                 │
├─────────────────────────────────────────────────┤
│              Agent Tooling                        │
│  @aleo-viem/core/agent — tool schemas + handlers │
│  @aleo-viem/core/mcp   — MCP server              │
├─────────────────────────────────────────────────┤
│                  Accounts                        │
│  RpcAccount     LocalAccount    ViewOnlyAccount  │
│  (wallet)       (private key)   (view key)       │
├─────────────────────────────────────────────────┤
│                 Transports                       │
│  http()         custom()        fallback()       │
├─────────────────────────────────────────────────┤
│            Client Configuration                  │
│  proving: { mode, url, apiKey }                  │
│  records: config object or custom impl           │
├─────────────────────────────────────────────────┤
│             Adapter Packages                     │
│  @aleo-viem/wallet-adapter  @aleo-viem/provable  │
├─────────────────────────────────────────────────┤
│          Aleo Network / Wallet Adapter           │
└─────────────────────────────────────────────────┘
```

### Interface-first design

aleo-viem defines interfaces. Implementations plug in.

- **Transport** — any object with a `request(method, params)` function
- **Account** — describes capabilities (can sign? has private key? has view key?), not origin
- **Proving** — a client configuration (`mode: 'delegated' | 'local'`), not a standalone interface. Wallets handle proving internally; only SDK/local users configure it.
- **Records** — config object for common cases (`{ mode: 'network', url }`) or custom implementation (`{ getRecords: ... }`) for advanced use cases.

Core has zero hard dependencies. Adapter packages (`@aleo-viem/wallet-adapter`, `@aleo-viem/provable`) bridge to the ecosystem's existing SDKs.

### Supported backends

aleo-viem wraps these existing tools through its adapter packages:

- **[Aleo Wallet Adapter](https://github.com/ProvableHQ/aleo-dev-toolkit/tree/master/packages/aleo-wallet-adaptor)** — Leo Wallet, Puzzle Wallet, Fox Wallet, Shield Mobile Wallet
- **[@provablehq/sdk](https://www.npmjs.com/package/@provablehq/sdk)** — WASM-based SDK for browser/node
- **[Shield Mobile SDK](https://github.com/ProvableHQ/shield-mobile-sdk)** — Native SDK for React Native

## Actions Reference

### Public Actions (no account required)

| Method | Description | Agent Tool |
|--------|-------------|------------|
| `getBlockNumber()` | Current chain height | `aleo_get_block_number` |
| `getBlock({ height?, hash? })` | Fetch block by height or hash | `aleo_get_block` |
| `getTransaction({ id })` | Fetch transaction by ID | `aleo_get_transaction` |
| `getBalance({ address })` | Public credits balance | `aleo_get_balance` |
| `readContract({ program, mapping, key })` | Read a program mapping value | `aleo_read_mapping` |
| `getCode({ program })` | Fetch program source code | `aleo_get_program_source` |
| `describeProgram({ program })` | Introspect program functions and mappings | `aleo_describe_program` |
| `estimateGas({ program, function, inputs })` | Estimate execution fee | `aleo_estimate_gas` |
| `getRecords({ program })` | Fetch records (Aleo-native) | `aleo_get_records` |
| `getTransitionViewKeys({ transactionId })` | Get transition view keys (Aleo-native) | `aleo_get_transition_view_keys` |

### Wallet Actions (account required — must be SignerAccount)

| Method | Description | Agent Tool |
|--------|-------------|------------|
| `sendTransaction({ transaction })` | Broadcast a built transaction | `aleo_send_transaction` |
| `writeContract({ program, function, inputs, fee })` | Execute a program transition | `aleo_execute` |
| `executeTransaction(...)` | Alias for `writeContract` | `aleo_execute` |
| `deployContract({ program, fee })` | Deploy a program | `aleo_deploy` |
| `signMessage({ message })` | Sign an arbitrary message | — |
| `transfer({ to, amount })` | Transfer credits (convenience) | `aleo_transfer` |
| `decrypt({ ciphertext })` | Decrypt a ciphertext (Aleo-native) | — |
| `requestRecords({ program })` | Request records (Aleo-native) | — |
| `waitForTransaction({ id })` | Wait for confirmation | `aleo_wait_for_transaction` |

## Naming Convention

If viem has a name for the concept, aleo-viem uses it. Aleo-specific names are only used for concepts with no EVM equivalent (records, decrypt, transition view keys). `executeTransaction` is provided as an alias for `writeContract` to stay consistent with Aleo wallet adapter terminology.

| viem concept | aleo-viem equivalent |
|---|---|
| `getBalance` | `getBalance` — reads public credits |
| `readContract` | `readContract` — reads program mapping |
| `writeContract` | `writeContract` / `executeTransaction` — executes program transition |
| `deployContract` | `deployContract` — deploys program |
| `getCode` | `getCode` — fetches program source |
| `estimateGas` | `estimateGas` — estimates fee |
| `sendTransaction` | `sendTransaction` — broadcasts transaction |
| `signMessage` | `signMessage` — signs message |
| `getContract` | `getContract` — typed contract instance from program source |

## Project Structure

```
aleo-viem/
├── packages/
│   ├── core/                # @aleo-viem/core (zero dependencies)
│   │   └── src/
│   │       ├── clients/     # createPublicClient, createWalletClient
│   │       ├── accounts/    # rpcAccount, privateKeyToAccount, etc.
│   │       ├── transports/  # http, custom, fallback
│   │       ├── actions/     # public/ and wallet/ actions
│   │       ├── contract/    # getContract, parseProgram
│   │       ├── agent/       # Agent tool schemas + handlers (@aleo-viem/core/agent)
│   │       ├── mcp/         # MCP server (@aleo-viem/core/mcp)
│   │       ├── types/       # core type definitions
│   │       ├── errors/      # error types (actionable messages)
│   │       └── utils/       # address validation, credits, value parsing
│   ├── wallet-adapter/      # @aleo-viem/wallet-adapter (wraps wallet standard)
│   └── provable/            # @aleo-viem/provable (wraps @provablehq/sdk)
├── skills/                  # Skill definitions for code-writing agents
├── docs/
│   ├── specs/               # Design specifications
│   └── plans/               # Implementation plans
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
