import { toMcpServer, type McpServer } from '@provablehq/veil-core/mcp'
import { createShieldSwapAgentTools } from '../agent/index.js'
import type { ShieldSwapAgentToolsConfig } from '../agent/types.js'

export type { McpServer, McpToolDefinition } from '@provablehq/veil-core/mcp'

/**
 * Creates an MCP server exposing the shield_swap tools.
 *
 * A thin binding of core's `toMcpServer` to {@link createShieldSwapAgentTools}
 * — the same tool set (pure derivations always; chain reads, DEX API reads,
 * composed balances, and opt-in writes gated by which backing is configured),
 * served over MCP. To serve DEX tools alongside the base Aleo tools, call
 * core's `toMcpServer` with both arrays concatenated.
 *
 * Exposed via subpath export: `import { createShieldSwapMcpServer } from '@provablehq/shield-swap-sdk/mcp'`.
 *
 * @param config The client and/or API client to bind, and the default program.
 * @returns An {@link McpServer} whose `handleToolCall` dispatches by tool name.
 *
 * @example
 * const client = walletClient.extend(shieldSwapActions({ api: {} }))
 * const server = createShieldSwapMcpServer({ client, api: client.api })
 * const pools = await server.handleToolCall('shield_swap_list_pools', { limit: 5 })
 */
export function createShieldSwapMcpServer(config: ShieldSwapAgentToolsConfig): McpServer {
  return toMcpServer(createShieldSwapAgentTools(config))
}
