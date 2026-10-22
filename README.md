# Veil — TypeScript SDK for Aleo

A TypeScript interface for Aleo, inspired by [viem](https://github.com/wevm/viem). Wraps existing Aleo wallets and SDKs behind a unified, familiar API — for human developers and AI agents alike.

[Documentation](https://provablehq.github.io/veil/) · [Package guide](./site/docs/packages/overview.md) · [LLM documentation index](./llms.txt)

## Why

### Private Apps and Assets Using Viem-Like Semantics
Aleo allows users privacy in their assets and data and allows developers to build privacy into their Dapps. 

Veil provides semantics familiar to what EVM developers and agents expect. If you've built on Ethereum with `viem`, you already know how to use `veil` — same patterns, same method names, applied to Aleo.

```ts
import { createPublicClient, createWalletClient, http } from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'

// A read-only client — point a transport at an Aleo node (viem's createPublicClient).
const client = createPublicClient({
  transport: http('https://edge.provable.com/api/v2'),
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
// A connected wallet supplies both; a local key path uses @provablehq/veil-aleo-sdk.
const { account, transport } = fromWalletAdapter(walletAdapter)
const wallet = createWalletClient({ account, transport })

// writeContract mirrors viem: name the program + function, pass typed inputs.
const txId = await wallet.writeContract({
  program: 'my_program.aleo',
  function: 'transfer',
  inputs: ['aleo1...', '100u64'],
})
```

## What you can build

| Use case | What it enables |
| --- | --- |
| 👛 **Private Browser and Mobile dApps** | browser apps where a user's wallet (Shield, Leo, Puzzle, Fox) holds the keys and proves. (`@provablehq/veil-aleo-react-hooks`) |
| 💸 **Private Token Bridging & Shielding** | Shield public assets from Ethereum and Solana. Privately hold and transfer them |
| 📈 **Private DeFi** | Private swaps of Ethereum and Solana assets, private market making, private lending (`@provablehq/shield-swap-sdk`) |
| 🤖 **AI agents that use Aleo** | expose Aleo as MCP tools or drop tool schemas into any agent framework; agents can also write viem-style code directly. (`@provablehq/veil-core/agent`, `@provablehq/veil-core/mcp`) |
| **Aleo Program Development & Testing** | build, deploy, and test Aleo programs and dapps against a local Aleo node (`@provablehq/veil-leo`, `@provablehq/veil-aleo-devnode`) |

## Packages

`@provablehq/veil-core` is the base — every other package builds on its client, action,
and transport interfaces.

| Package | What it's for | When to use it |
|---------|---------------|----------------------|
| 🧩 [`@provablehq/veil-core`](./packages/core/README.md) | Clients, actions, transports, types — the base SDK. Also ships LLM agent (`/agent`) and MCP (`/mcp`) bindings. | Every Veil project — reading or writing Aleo, or as the base you extend. |
| 🔑 [`@provablehq/veil-aleo-sdk`](./packages/provable-sdk/README.md) | Local accounts, signing, and proving via `@provablehq/sdk`. Build a client from a private key. | Developing scripts, clis, server-side apps, or AI Agents using a locally custodied keys or server wallets |
| 🌐 [`@provablehq/veil-aleo-wallet-adapter`](./packages/wallet-adapter/README.md) | Bridge any Provable-standard wallet (Shield, Leo, Puzzle, Fox) into a Veil client. | Building Aleo browser or mobile dapps and integrations |
| ⚛️ [`@provablehq/veil-aleo-react-hooks`](./packages/react/README.md) | `VeilProvider` + `useVeilWallet()` — wallet connection and clients for React apps. | Building Aleo dapps with React |
| 📈 [`@provablehq/shield-swap-sdk`](./packages/shield-swap/README.md) | Client for the `shield_swap` AMM/DEX — private swaps, liquidity, and the DEX API. | Integrating with Shield Swap for private token swaps |
| 🖥️ [`@provablehq/shield-swap-cli`](./packages/shield-swap-cli/README.md) | The `shield-swap` command — setup, pools, balances, swaps, and liquidity from a terminal. | CLI for for private swaps on Shield Swap for humans or Agents |
| 📜 [`@provablehq/veil-codegen`](./packages/codegen/README.md) | Generate typed bindings from an Aleo program ABI (library + `veil-codegen` CLI). | Generating JS/TS contracts from Aleo smart contract ABIs |
| 🧪 [`@provablehq/veil-aleo-devnode`](./packages/devnode/README.md) | Run and drive a local Aleo devnode for tests. | Testing and local development with a local Aleo node |
| 🦁 [`@provablehq/veil-leo`](./packages/leo/README.md) | Typed wrapper around the `leo` CLI (build, deploy, …). | Compiling or deploying Leo programs — including during testing with Aleo Devnode (`@provablehq/veil-aleo-devnode`) |
| 💸 [`@provablehq/aleo-bridge-sdk`](./packages/bridge/README.md) | Cross-chain bridge client (preview). Versions in lockstep with the Veil packages; expect breaking changes between minor releases. | Bridging tokens to and from Aleo via EVM Chains (Circle ARC, Base, Arbitrum, etc.)  or Solana |

## Quick Start

### Read-only (no account needed)

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://edge.provable.com/api/v2'),
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
import { createWalletClient } from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'

const { account, transport } = fromWalletAdapter(walletAdapter)
const client = createWalletClient({ account, transport })

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
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

// loadNetwork builds the account, proving, and clients from a private key.
const aleo = await loadNetwork('testnet')

const { publicClient, walletClient } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://edge.provable.com/api/v2',
  provingMode: 'delegated', // or 'local' to prove in-process
  proverUrl: 'https://edge.provable.com/api/prove/testnet',
})
```

### Contract instances

```ts
import { getContract } from '@provablehq/veil-core'

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
import { createPublicClient, http, viewOnlyAccount } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://edge.provable.com/api/v2'),
})

const account = viewOnlyAccount({
  address: 'aleo1...',
  viewKey: 'AViewKey1...',
})

// Use the view key to decrypt records without signing authority
```

## Bridging in and out

`@provablehq/aleo-bridge-sdk` supports cross-chain transfers through Circle
xReserve, Circle CCTP, and Hyperlane. It connects Aleo assets to Ethereum and
Solana, and moves native USDC between Arc and Ethereum, Base, or Arbitrum.
The package is in preview; supported operations depend on the route's reviewed
deployment metadata. See the [bridge package guide](./packages/bridge/README.md)
for supported routes, wallet integrations, execution, and recovery.

```ts
import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({ environment: 'mainnet' })
const [route] = bridge.registry.getRoutes({
  environment: bridge.environment,
  protocol: 'xreserve',
  sourceChainId: 'ethereum',
  destinationChainId: 'aleo',
})

const quote = await bridge.quote({
  source: { chain: 'ethereum', asset: 'usdc' },
  destination: { chain: 'aleo', asset: 'usdcx' },
  bridgeProtocol: route.protocol,
  amount: '25',
  recipient: aleoAddress,
})
quote.plan.steps // approve → deposit → wait-attestation → mint
```

`quote` validates the route, amount precision, and recipient, reads current
fees where the provider exposes them, and returns the plan used for execution.
Quoting does not sign, submit, or move funds. Execution and recovery are separate
operations documented in the [bridge package guide](./packages/bridge/README.md).

## Agent Usage

veil is designed for two audiences equally: human developers who write code against the TypeScript library, and AI agents that either write code using viem patterns or call tools directly.

### For tool-calling agents (MCP)

Run the MCP server to expose all veil actions as tools:

```ts
import { createMcpServer } from '@provablehq/veil-core/mcp'
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://edge.provable.com/api/v2'),
})

await createMcpServer({ client })
```

Agents can then call tools like `aleo_get_balance`, `aleo_read_mapping`, `aleo_execute`, `aleo_describe_program`, etc. All tools return structured JSON with parsed Aleo values.

### For tool-calling agents (framework-agnostic)

Use agent tool schemas and handlers directly in any agent framework:

```ts
import { aleoAgentTools } from '@provablehq/veil-core/agent'

const tools = aleoAgentTools({
  client: publicClient,
  walletClient: walletClient,
})

// Each tool has { schema, handler } — plug into LangChain, Vercel AI SDK, etc.
```

## Record inventory management

Core reads records from a scanner and joins or splits them to prepare an
ARC20, ARC22, or native credits balance for spending. Shield Swap applies these
operations to each DEX token's underlying program. The separate
[`@provablehq/veil-cli`](packages/cli/README.md) runs background maintenance and
stores recovery data in SQLite.

Record reservations and recovery are off by default. Follow the
[record inventory guide](site/docs/guides/record-inventory.md) to enable them,
configure storage, and coordinate maintenance with trading.

## License

MIT
