---
sidebar_position: 2
---

# @provablehq/veil-core

The base of the SDK: a viem-shaped client library for Aleo. Read chain state
and write transactions through transports, public/wallet/test clients, and
standalone actions — plus agent- and MCP-facing bindings that expose those
actions to LLMs.

```bash
npm install @provablehq/veil-core
```

## Key exports

- **Clients** — `createPublicClient`, `createWalletClient`, `createTestClient`, `createClient`
- **Transports** — `http`, `custom`, `fallback`, `createTransport`
- **Contracts** — `getContract`, `readContract`, `writeContract`, `simulateContract`, `executeContract`, `deployContract`, `parseProgram`
- **Actions** — `getBlockNumber`, `getBlock`, `getTransaction`, `getBalance`, `transfer`, `requestRecords`, `readMapping`, `waitForConfirmation`
- **Accounts / types** — `rpcAccount`, `toAccount`; `PublicClient`, `WalletClient`, `Account`, `Transport`, `ABI`, `ProvingConfig`

See the [Clients](../clients/public-client) pages for the full action
surface, [Guides](../guides/reading-chain-state) for common flows, and
[API](../api/types) for the type and transport reference.

## Subpaths

- **`@provablehq/veil-core/agent`** — framework-agnostic LLM tool bindings: `createAgentTools`, `aleoAgentToolSchemas`, and the `AgentTool` / `AgentToolSchema` types.
- **`@provablehq/veil-core/mcp`** — adapt agent tools into an MCP server: `toMcpServer(tools)` (package-agnostic) and `createMcpServer(config)` for the base Aleo tools.

```ts
import { createMcpServer } from '@provablehq/veil-core/mcp'

const server = createMcpServer({ client, walletClient })
const tools = server.tools
const result = await server.handleToolCall('aleo_get_block_number', {})
```
