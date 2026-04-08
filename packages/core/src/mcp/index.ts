import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import { aleoAgentTools, type AgentToolDefinition } from '../agent/index.js'

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
 * Creates an MCP server exposing veil actions as tools.
 *
 * This is a lightweight wrapper around aleoAgentTools that formats
 * the output for MCP protocol consumption.
 *
 * Exposed via subpath export: import { createMcpServer } from '@veil/core/mcp'
 */
export function createMcpServer(config: McpServerConfig): McpServer {
  const agentTools = aleoAgentTools(config)

  const toolMap = new Map<string, AgentToolDefinition>()
  for (const tool of agentTools) {
    toolMap.set(tool.name, tool)
  }

  return {
    tools: agentTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),

    handleToolCall: async (name: string, input: Record<string, unknown>) => {
      const tool = toolMap.get(name)
      if (!tool) {
        throw new Error(
          `Unknown tool: "${name}". Available tools: ${agentTools.map((t) => t.name).join(', ')}`,
        )
      }
      return tool.handler(input)
    },
  }
}
