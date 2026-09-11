import { toMcpServer, type McpServer } from '@provablehq/veil-core/mcp'
import { createBridgeAgentTools } from '../agent/tools.js'
import type { BridgeClient } from '../clients/createBridgeClient.js'

export type { McpServer, McpToolDefinition } from '@provablehq/veil-core/mcp'

/**
 * Creates an MCP server for discovering and describing cross-chain transfers.
 *
 * The exposed tools list assets and routes and validate a proposed transfer.
 * They cannot read live prices, access a wallet, request a signature, submit a
 * transaction, or move funds.
 *
 * Exposed via subpath export: `import { createBridgeMcpServer } from '@provablehq/aleo-bridge-sdk/mcp'`.
 *
 * @param client Bridge client supplying the supported asset and route catalog.
 * @returns MCP server exposing the non-fund-moving bridge tools.
 *
 * @example
 * const server = createBridgeMcpServer(client)
 * const routes = await server.handleToolCall('bridge_list_routes', {
 *   protocol: 'xreserve',
 * })
 */
export function createBridgeMcpServer(client: BridgeClient): McpServer {
  return toMcpServer(createBridgeAgentTools(client))
}
