import { toMcpServer, type McpServer } from '@provablehq/veil-core/mcp'
import { createBridgeAgentTools } from '../agent/tools.js'
import type { BridgeClient } from '../clients/createBridgeClient.js'

export type { McpServer, McpToolDefinition } from '@provablehq/veil-core/mcp'

/**
 * Creates an MCP server exposing the bridge tools.
 *
 * Binds core's `toMcpServer` to the protocol bridge discovery and planning
 * tools. The current server cannot sign transactions or move funds.
 *
 * Exposed via subpath export: `import { createBridgeMcpServer } from '@provablehq/aleo-bridge-sdk/mcp'`.
 *
 * @param client A bridge client from `createBridgeClient`.
 * @returns An {@link McpServer} whose `handleToolCall` dispatches by tool name.
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
