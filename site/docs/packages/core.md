---
sidebar_position: 2
---

# @provablehq/veil-core

The base of the SDK: a viem-shaped client library for Aleo. Every other
`@provablehq/veil-*` package builds on the clients, transports, and action
types this package defines. It reads chain state and writes transactions
through public, wallet, and test clients and their standalone actions, and it
ships agent- and MCP-facing bindings that expose those same actions to LLMs.

## Installation

```bash
npm install @provablehq/veil-core
```

## Key exports

- **Clients** — `createPublicClient`, `createWalletClient`, `createTestClient`, `createClient`.
- **Transports** — `http`, `custom`, `fallback`, `createTransport`.
- **Contracts** — `getContract`, `readContract`, `writeContract`, `simulateContract`, `executeContract`, `deployContract`, `parseProgram`.
- **Actions** — `getBlockNumber`, `getBlock`, `getTransaction`, `getBalance`, `transfer`, `requestRecords`, `readMapping`, `waitForConfirmation`, and the rest of the public/wallet/test surface.
- **Accounts / types** — `rpcAccount`, `toAccount`; `PublicClient`, `WalletClient`, `Account`, `Transport`, `ABI`, `ProvingConfig`.

## Example

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const balance = await client.getBalance({
  address: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
```

See the [Clients](/clients/public-client) pages for the full action surface,
[Guides](/guides/reading-chain-state) for common flows, and
[API](/api/types) for the type and transport reference.

## Subpaths

- **`@provablehq/veil-core/agent`** — framework-agnostic LLM tool bindings: `createAgentTools`, `aleoAgentTools`, `aleoAgentToolSchemas`, and the `AgentTool` / `AgentToolSchema` types.
- **`@provablehq/veil-core/mcp`** — adapts agent tools into an MCP server: `toMcpServer(tools)` (package-agnostic) and `createMcpServer(config)` for the base Aleo tools.

```ts
import { createMcpServer } from '@provablehq/veil-core/mcp'

const server = createMcpServer({ client, walletClient })
const tools = server.tools
const result = await server.handleToolCall('aleo_get_block_number', {})
```

See [Agents](/guides/agents) for how the agent and MCP surfaces compose across
packages.
