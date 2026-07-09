---
sidebar_position: 7
---

# Agents

An LLM agent that reads or writes Aleo state needs its capabilities
described as tools: a name, a description the model reads to decide when to
call it, a JSON Schema for its arguments, and a handler that actually runs
when the model calls it. `@provablehq/veil-core` ships that description for
its own read and write actions under a `/agent` subpath, and an MCP server
binding under `/mcp`. `@provablehq/shield-swap-sdk` ships the same two
subpaths for DEX actions, in a shape designed to sit alongside the core
tools rather than replace them.

## The tool shape

An `AgentTool` pairs a schema with the handler that executes it:

```ts
type AgentToolSchema = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

type AgentToolHandler = (params: Record<string, unknown>) => Promise<unknown>

type AgentTool = { schema: AgentToolSchema; handler: AgentToolHandler }
```

This maps directly onto MCP's tool declaration and onto the tool/function
shapes LangChain, the Vercel AI SDK, and the Claude and OpenAI APIs each use,
so one set of schemas and handlers serves any of them — only the adapter
that registers the tools and routes calls to `handler` changes.

## Core tools

[`createAgentTools`](/packages/core) builds the full set of `AgentTool`s for
the base Aleo actions, gated by which clients are passed in: a `PublicClient`
enables the read-only tools, a `WalletClient` enables the tools that sign and
spend.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'
import { createAgentTools } from '@provablehq/veil-core/agent'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const tools = createAgentTools({ client })
```

| Tool | Needs | Description |
| --- | --- | --- |
| `aleo_get_block_number` | client | Current chain height |
| `aleo_get_balance` | client | Public credits balance for an address |
| `aleo_read_mapping` | client | Read a value from a program's public mapping |
| `aleo_get_program` | client | Fetch a deployed program's source |
| `aleo_get_block` | client | Fetch a block by height or hash |
| `aleo_get_transaction` | client | Fetch a transaction by id |
| `aleo_describe_program` | client | Parse a program's functions, mappings, and closures |
| `aleo_execute` | walletClient | Execute a program function |
| `aleo_transfer` | walletClient | Transfer credits to an address |
| `aleo_deploy` | walletClient | Deploy a program |

`aleoAgentToolSchemas(config?)` returns the schemas alone, filtered the same
way, for a caller that wants to register tool descriptions with a model
without wiring up execution yet. Every write tool signs, proves, and
broadcasts when called — an agent with a `walletClient` configured pays fees
on every `aleo_execute`, `aleo_transfer`, or `aleo_deploy` call the model
makes.

## Serving tools over MCP

[`createMcpServer`](/packages/core) adapts `createAgentTools`'s output into
an MCP server — a tool list plus a dispatcher. It is not a running process;
the caller still wires the returned `tools` and `handleToolCall` into an MCP
SDK server over whichever transport it uses (stdio, HTTP):

```ts
import { createMcpServer } from '@provablehq/veil-core/mcp'

const server = createMcpServer({ client })

const result = await server.handleToolCall('aleo_get_block_number', {})
// { height: '3082441' }
```

`toMcpServer(tools)` is the package-agnostic version underneath — it takes
any `AgentTool[]`, not core's specifically, which is how a caller combines
tool sets from more than one package.

## Shield Swap tools

`@provablehq/shield-swap-sdk` exposes the same two subpaths for its DEX
actions. `createShieldSwapAgentTools` returns `AgentTool[]` in the identical
shape core's `createAgentTools` returns, gated by which backing is
configured: a client extended with `shieldSwapActions` enables on-chain
reads and private-balance lookups, an `api` client enables the off-chain DEX
API reads (pool listing, routing, token registry), and both together enable
the tools that combine them. Money-moving writes — swap, mint, add or remove
liquidity — are opt-in via `includeWrites`, since a model calling them can
move funds. The write tools target the local-signer path: they auto-select
records and auto-fetch the dynamic-dispatch program sources, so the agent
supplies only amounts and token programs. `walletClient` below is the same
[wallet client](/clients/wallet-client) used throughout the rest of the docs:

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { createShieldSwapAgentTools } from '@provablehq/shield-swap-sdk/agent'

const swapClient = walletClient.extend(
  shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }),
)

const tools = createShieldSwapAgentTools({
  client: swapClient,
  api: swapClient.api,
  includeWrites: true,
})
```

`createShieldSwapMcpServer({ client, api })` from `@provablehq/shield-swap-sdk/mcp`
is the equivalent MCP binding, serving only the `shield_swap_*` tool set.

## Combining tool sets

Because `createAgentTools` and `createShieldSwapAgentTools` both return
`AgentTool[]`, serving Aleo and DEX tools from one MCP server is a matter of
concatenating the two arrays before calling core's `toMcpServer`. Reusing
`client` from [Core tools](#core-tools) above and `swapClient` from
[Shield Swap tools](#shield-swap-tools):

```ts
import { createAgentTools } from '@provablehq/veil-core/agent'
import { toMcpServer } from '@provablehq/veil-core/mcp'

const coreTools = createAgentTools({ client, walletClient })
const swapTools = createShieldSwapAgentTools({ client: swapClient, api: swapClient.api })

const server = toMcpServer([...coreTools, ...swapTools])

const pools = await server.handleToolCall('shield_swap_list_pools', { limit: 5 })
const height = await server.handleToolCall('aleo_get_block_number', {})
```

The same `AgentTool[]` array registers directly with LangChain, the Vercel
AI SDK, or a hand-rolled Claude or OpenAI tool-use loop — `toMcpServer` is
only needed for the MCP transport specifically.
