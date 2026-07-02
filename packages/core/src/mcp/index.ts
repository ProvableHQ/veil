import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import { createAgentTools, type AgentTool } from '../agent/index.js'

export type McpServerConfig = {
  client?: PublicClient
  walletClient?: WalletClient
}

export type McpToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpServer = {
  tools: McpToolDefinition[]
  handleToolCall: (name: string, input: Record<string, unknown>) => Promise<unknown>
}

/**
 * Adapts any {@link AgentTool}s into an MCP server (tool list + dispatcher).
 *
 * Package-agnostic — feed it `createAgentTools` output, `@veil/shield-swap`'s
 * `createShieldSwapAgentTools`, or any mix, to expose them over MCP. Pure and
 * local; the handlers hit the network only when a tool is invoked.
 *
 * @param tools The tools to serve. Later tools win on a name collision.
 * @returns An {@link McpServer} whose `handleToolCall` dispatches by tool name
 *   and throws on an unknown name.
 *
 * @example
 * const server = toMcpServer(createShieldSwapAgentTools({ client, api }))
 */
export function toMcpServer(tools: AgentTool[]): McpServer {
  const toolMap = new Map(tools.map((t) => [t.schema.name, t]))
  return {
    tools: tools.map((t) => ({
      name: t.schema.name,
      description: t.schema.description,
      inputSchema: t.schema.inputSchema as Record<string, unknown>,
    })),
    handleToolCall: async (name: string, input: Record<string, unknown>) => {
      const tool = toolMap.get(name)
      if (!tool) {
        throw new Error(
          `Unknown tool: "${name}". Available tools: ${tools.map((t) => t.schema.name).join(', ')}`,
        )
      }
      return tool.handler(input)
    },
  }
}

/**
 * Creates an MCP server exposing the base Aleo actions as tools.
 *
 * A thin binding of {@link toMcpServer} to the built-in Aleo tool set. For a
 * different or combined tool set (e.g. DEX tools), call `toMcpServer` directly.
 *
 * Exposed via subpath export: import { createMcpServer } from '@veil/core/mcp'
 */
export function createMcpServer(config: McpServerConfig): McpServer {
  return toMcpServer(createAgentTools(config))
}
