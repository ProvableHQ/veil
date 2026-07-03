# veil

A TypeScript interface for Aleo, inspired by [viem](https://github.com/wevm/viem). Wraps existing Aleo wallets and SDKs behind a unified, familiar API — for human developers and AI agents alike.

## Why

### Private Apps and Assets Using EVM-Style semantics
Aleo allows users privacy in their assets and data and allows developers to build privacy into their Dapps. 

Veil provides semantics familiar to what EVM developers and agents expect. If you've built on Ethereum with `viem`, you already know how to use `veil` — same patterns, same method names, applied to Aleo.

```ts
import { createPublicClient, createWalletClient, custom, http, rpcAccount } from '@veil/core'

// A read-only client — point a transport at an Aleo node (viem's createPublicClient).
const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

// Similar method names as in viem, now reading Aleo state.
const height = await client.getBlockNumber()          // current chain height
const balance = await client.getBalance({ address: 'aleo1...' })  // public credits

// readContract reads a program mapping: mapping[key] in `credits.aleo`.
const value = await client.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})

// For writes, a wallet client pairs a transport with an account — same as viem.
const wallet = createWalletClient({
  account: rpcAccount(walletAdapter),  // or privateKeyToAccount(...) for a local key
  transport: custom(walletAdapter),
})

// writeContract mirrors viem: name the program + function, pass typed inputs.
const txId = await wallet.writeContract({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
})
```

## What you can build

👛 **Wallet-connected dApps** — browser apps where a user's wallet (Shield, Leo, Puzzle, Fox) holds the keys and proves. (`@veil/react`)

🔭 **Explorers, dashboards, and indexers** — read blocks, transactions, mappings, staking, and network metrics with no keys and no proving. (`@veil/core`)

💸 **Payments and token flows** — public or private credit transfers and ARC-0020 tokens, including confidential transfers.

📈 **Shield Swap trading** — private swaps, liquidity, and pool/price reads, from a frontend, a programmatic bot, or an agent. (`@veil/shield-swap`)

🤖 **AI agents that use Aleo** — expose Aleo as MCP tools or drop tool schemas into any agent framework; agents can also write viem-style code directly. (`@veil/core/agent`, `@veil/core/mcp`)

🖥️ **Servers, CLIs, and custodial services** — hold a private key and sign and prove locally, unattended. (`@veil/provable-sdk`)

📜 **Typed clients for your own contracts** — generate bindings from a program ABI and call it with typed reads and writes. (`@veil/codegen`, `getContract`)

🦁 **Leo program pipelines** — build, deploy, and test programs against a local node, including in CI. (`@veil/leo`, `@veil/devnode`)

## Features

⚡ **Viem-compatible API** — `getBalance`, `readContract`, `writeContract`, `deployContract`, `sendTransaction`, `signMessage`, and more

🧩 **Interface-first** — core has zero hard dependencies on any SDK. Wallets and SDKs plug in via adapter packages.

🔑 **Multiple account types** — RPC accounts (wallet adapters), local accounts (private key, mnemonic), view-only accounts

🔌 **Pluggable transports** — `http()` for Aleo REST API, `custom()` for wallet adapters, `fallback()` for chaining

📜 **Contract instances** — `getContract()` parses Aleo program source and provides typed `read`/`write` methods

🔏 **Proving as configuration** — proving strategy is a client config concern (`delegated` or `local`), not a separate abstraction

🤖 **Agent-first** — every action ships with an MCP tool, agent tool schema, and structured JSON output. AI agents can call Aleo directly via tool use or write code against the library using viem patterns they already know.

## Packages

`@veil/core` is the base — every other package builds on its client, action,
and transport interfaces.

| Package | What it's for | When to reach for it |
|---------|---------------|----------------------|
| `@veil/core` | Clients, actions, transports, types — the base SDK. Also ships LLM agent (`/agent`) and MCP (`/mcp`) bindings. | Every Veil project — reading or writing Aleo, or as the base you extend. |
| `@veil/provable-sdk` | Local accounts, signing, and proving via `@provablehq/sdk`. Build a client from a private key. | Your code holds a private key and must sign and prove itself — bots, servers, CLIs, tests. |
| `@veil/wallet-adapter` | Bridge any Provable-standard wallet (Shield, Leo, Puzzle, Fox) into a Veil client. | You need wallet signing outside React, or a custom (non-React) wallet integration. |
| `@veil/react` | `VeilProvider` + `useVeilWallet()` — wallet connection and clients for React apps. | You're building a React dApp with wallet connection. |
| `@veil/shield-swap` | Client for the `shield_swap` AMM/DEX — private swaps, liquidity, and the DEX API. | You're integrating the Shield Swap DEX — swaps, liquidity, or pool/price data. |
| `@veil/codegen` | Generate typed bindings from an Aleo program ABI (library + `veil-codegen` CLI). | You want typed reads and writes for a specific program's ABI. |
| `@veil/devnode` | Run and drive a local Aleo devnode for tests. | You need a local Aleo node in tests or local development. |
| `@veil/leo` | Typed wrapper around the `leo` CLI (build, deploy, …). | You compile or deploy Leo programs — including during testing, where it pairs with `@veil/devnode`. |
| `@veil/bridge` | Cross-chain bridge client (preview). | Not yet — in preview, not published. |

## Quick Start

### Read-only (no account needed)

```ts
import { createPublicClient, http } from '@veil/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

// Familiar viem-style actions
const height = await client.getBlockNumber()
const block = await client.getBlock({ height: 1000 })
const tx = await client.getTransaction({ id: 'at1...' })
const balance = await client.getBalance({ address: 'aleo1...' })
const source = await client.getCode({ programId: 'credits.aleo' })
const value = await client.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

### Wallet (signing delegated to wallet adapter)

```ts
import { createWalletClient, custom, rpcAccount } from '@veil/core'

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
import { loadNetwork } from '@veil/provable-sdk'

// loadNetwork builds the account, proving, and clients from a private key.
const aleo = await loadNetwork('testnet')

const { publicClient, walletClient } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated', // or 'local' to prove in-process
  proverUrl: 'https://api.provable.com/prove/testnet',
})
```

### Contract instances

```ts
import { getContract } from '@veil/core'

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
import { createPublicClient, http, viewOnlyAccount } from '@veil/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

const account = viewOnlyAccount({
  address: 'aleo1...',
  viewKey: 'AViewKey1...',
})

// Use the view key to decrypt records without signing authority
```

## Bridging in and out

`@veil/bridge` moves value between Aleo and other chains (Solana, Ethereum and
other EVM networks, Bitcoin, Tron) through third-party swap providers. Aleo is
always one side of the pair. Amounts are decimal strings in display units, and
assets use the API's chain-qualified codes (`ALEO_MAINNET`, `USDC_ETH`) —
never bare symbols.

Bridging **out** is one call. The client carries the signing wallet, and
`swap` runs the whole chain: quote the route, create the order, sign and
broadcast the Aleo deposit, and (with `poll`) wait until the funds arrive:

```ts
import { createBridgeClient, httpBridge } from '@veil/bridge'

const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
  wallet: walletClient, // @veil/core WalletClient — signs the Aleo deposit
})

const result = await bridge.swap({
  from: { asset: 'ALEO_MAINNET', amount: '100' },
  to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: solAddress },
  poll: true, // wait for COMPLETED
})
result.depositTxId // at1... — the Aleo deposit
```

Bridging **in** starts on the other chain, so the deposit is signed there —
from this SDK you quote the route and create the order, then pay the returned
deposit instructions from the source-chain wallet:

```ts
const { quotes } = await bridge.getQuotes({
  srcChain: 'EVM:1', srcAsset: 'USDC_ETH',
  destChain: 'ALEO', destAsset: 'USDC_ALEO',
  amountIn: '250',
  recipientAddress: aleoAddress, // where the USDC lands on Aleo
  refundAddress: ethAddress,
})
const q = quotes[0]
const order = await bridge.createOrder({
  providerId: q.provider.id,
  srcChain: q.srcChain, destChain: q.destChain,
  srcAsset: q.srcAsset, destAsset: q.destAsset,
  amountIn: q.amountIn,
  walletAddress: aleoAddress,
  quoteId: (q.quoteId ?? q.quoteOptionId)!,
})
// → pay order.depositAmount to order.depositAddress from the user's EVM
//   wallet — that side is plain viem (an erc20 transfer via writeContract;
//   see packages/bridge/README.md for the full snippet) — then
await bridge.waitForOrder({ id: order.orderId })
```

Bridged-in assets are ordinary Aleo tokens — tradeable on the Shield Swap DEX
via `@veil/shield-swap` with the same wallet client. The live examples are the
e2e tests:
[`packages/bridge/test/integration/e2e.test.ts`](./packages/bridge/test/integration/e2e.test.ts)
runs the full outbound swap chain, and
[`packages/shield-swap/test/integration/bridgeRoundTrip.e2e.test.ts`](./packages/shield-swap/test/integration/bridgeRoundTrip.e2e.test.ts)
chains bridge in → DEX swap → bridge out. See
[`packages/bridge/README.md`](./packages/bridge/README.md) for providers,
routes, and route discovery.

## Agent Usage

veil is designed for two audiences equally: human developers who write code against the TypeScript library, and AI agents that either write code using viem patterns or call tools directly.

### For tool-calling agents (MCP)

Run the MCP server to expose all veil actions as tools:

```ts
import { createMcpServer } from '@veil/core/mcp'
import { createPublicClient, http } from '@veil/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

await createMcpServer({ client })
```

Agents can then call tools like `aleo_get_balance`, `aleo_read_mapping`, `aleo_execute`, `aleo_describe_program`, etc. All tools return structured JSON with parsed Aleo values.

### For tool-calling agents (framework-agnostic)

Use agent tool schemas and handlers directly in any agent framework:

```ts
import { aleoAgentTools } from '@veil/core/agent'

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
import { parseValue, encodeValue } from '@veil/core'

parseValue('100u64')       // → { value: 100n, type: 'u64' }
parseValue('aleo1abc...')  // → { value: 'aleo1abc...', type: 'address' }
encodeValue(100n, 'u64')   // → '100u64'
```

### Actionable errors

Every error message is an instruction an agent can act on:

```
Program "my_program.aleo" not found. Verify the program ID is correct
and has been deployed: await client.getCode({ programId: 'my_program.aleo' })
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
│  getRecords        transfer                      │
│  describeProgram   decrypt                       │
│                    requestRecords                │
├─────────────────────────────────────────────────┤
│              Contract Instances                   │
│  getContract({ programSource, client })          │
│  → contract.read.mappingName()                   │
│  → contract.write.functionName()                 │
├─────────────────────────────────────────────────┤
│              Agent Tooling                        │
│  @veil/core/agent — tool schemas + handlers │
│  @veil/core/mcp   — MCP server              │
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
│  @veil/wallet-adapter  @veil/provable-sdk  │
├─────────────────────────────────────────────────┤
│          Aleo Network / Wallet Adapter           │
└─────────────────────────────────────────────────┘
```

### Interface-first design

veil defines interfaces. Implementations plug in.

- **Transport** — any object with a `request(method, params)` function
- **Account** — describes capabilities (can sign? has private key? has view key?), not origin
- **Proving** — a client configuration (`mode: 'delegated' | 'local'`), not a standalone interface. Wallets handle proving internally; only SDK/local users configure it.
- **Records** — config object for common cases (`{ mode: 'network', url }`) or custom implementation (`{ getRecords: ... }`) for advanced use cases.

Core has zero hard dependencies. Adapter packages (`@veil/wallet-adapter`, `@veil/provable-sdk`) bridge to the ecosystem's existing SDKs.

### Supported backends

veil wraps these existing tools through its adapter packages:

- **[Aleo Wallet Adapter](https://github.com/ProvableHQ/aleo-dev-toolkit/tree/master/packages/aleo-wallet-adaptor)** — Leo Wallet, Puzzle Wallet, Fox Wallet, Shield Mobile Wallet
- **[@provablehq/sdk](https://www.npmjs.com/package/@provablehq/sdk)** — WASM-based SDK for browser/node

## Actions Reference

### Public Actions (no account required)

| Method | Description | Agent Tool |
|--------|-------------|------------|
| `getBlockNumber()` | Current chain height | `aleo_get_block_number` |
| `getBlock({ height?, hash? })` | Fetch block by height or hash | `aleo_get_block` |
| `getTransaction({ id })` | Fetch transaction by ID | `aleo_get_transaction` |
| `getBalance({ address })` | Public credits balance | `aleo_get_balance` |
| `readContract({ programId, mapping, key })` | Read a program mapping value | `aleo_read_mapping` |
| `getCode({ programId })` | Fetch program source code | `aleo_get_program_source` |
| `describeProgram({ program })` | Introspect program functions and mappings | `aleo_describe_program` |
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

If viem has a name for the concept, veil uses it. Aleo-specific names are only used for concepts with no EVM equivalent (records, decrypt, transition view keys). `executeTransaction` is provided as an alias for `writeContract` to stay consistent with Aleo wallet adapter terminology.

| viem concept | veil equivalent |
|---|---|
| `getBalance` | `getBalance` — reads public credits |
| `readContract` | `readContract` — reads program mapping |
| `writeContract` | `writeContract` / `executeTransaction` — executes program transition |
| `deployContract` | `deployContract` — deploys program |
| `getCode` | `getCode` — fetches program source |
| `sendTransaction` | `sendTransaction` — broadcasts transaction |
| `signMessage` | `signMessage` — signs message |
| `getContract` | `getContract` — typed contract instance from program source |

## Project Structure

```
veil/
├── packages/
│   ├── core/                # @veil/core (zero dependencies)
│   │   └── src/
│   │       ├── clients/     # createPublicClient, createWalletClient
│   │       ├── accounts/    # rpcAccount, privateKeyToAccount, etc.
│   │       ├── transports/  # http, custom, fallback
│   │       ├── actions/     # public/ and wallet/ actions
│   │       ├── contract/    # getContract, parseProgram
│   │       ├── agent/       # Agent tool schemas + handlers (@veil/core/agent)
│   │       ├── mcp/         # MCP server (@veil/core/mcp)
│   │       ├── types/       # core type definitions
│   │       ├── errors/      # error types (actionable messages)
│   │       └── utils/       # address validation, credits, value parsing
│   ├── provable-sdk/        # @veil/provable-sdk (wraps @provablehq/sdk)
│   ├── wallet-adapter/      # @veil/wallet-adapter (wraps wallet standard)
│   ├── react/              # @veil/react (VeilProvider, useVeilWallet)
│   ├── shield-swap/         # @veil/shield-swap (shield_swap AMM/DEX client)
│   ├── codegen/             # @veil/codegen (ABI → typed bindings + CLI)
│   ├── devnode/             # @veil/devnode (local Aleo devnode for tests)
│   ├── leo/                 # @veil/leo (typed leo CLI wrapper)
│   └── bridge/              # @veil/bridge (cross-chain bridge client, preview)
├── skills/                  # Skill definitions for code-writing agents
├── site/                    # Docusaurus documentation site
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
