import { toMcpServer, type McpServer } from '@provablehq/veil-core/mcp'
import { createBridgeAgentTools } from '../agent/tools.js'
import type { BridgeClient } from '../clients/createBridgeClient.js'

export type { McpServer, McpToolDefinition } from '@provablehq/veil-core/mcp'

/**
 * Creates an MCP server exposing the bridge tools.
 *
 * A thin binding of core's `toMcpServer` to {@link createBridgeAgentTools} —
 * the same tool set (flags, quotes, orders, the end-to-end swap), served over
 * MCP. To serve bridge tools alongside the base Aleo tools (or the DEX tools),
 * call core's `toMcpServer` with the arrays concatenated.
 *
 * Exposed via subpath export: `import { createBridgeMcpServer } from '@provablehq/veil-bridge/mcp'`.
 *
 * @param client A bridge client from `createBridgeClient`.
 * @returns An {@link McpServer} whose `handleToolCall` dispatches by tool name.
 *
 * @example
 * const server = createBridgeMcpServer(client)
 * const { quotes } = await server.handleToolCall('bridge_get_quotes', {
 *   srcChain: 'ALEO', srcAsset: 'ALEO_MAINNET',
 *   destChain: 'SOLANA', destAsset: 'SOL_SOLANA',
 *   amountIn: '100', recipientAddress: sol, refundAddress: aleo,
 * })
 */
export function createBridgeMcpServer(client: BridgeClient): McpServer {
  return toMcpServer(createBridgeAgentTools(client))
}
