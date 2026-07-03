import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import { createAgentTools, type AgentTool } from '../agent/index.js'

/**
 * Selects which tool sets `createMcpServer` exposes.
 *
 * Pass only `client` for a read-only server; add `walletClient` to expose the
 * write tools as well.
 *
 * @property client Backs the read-only tools; when absent they are omitted.
 * @property walletClient Backs the write tools (execute, transfer, deploy);
 *   when absent they are omitted.
 */
export type McpServerConfig = {
  client?: PublicClient
  walletClient?: WalletClient
}

/**
 * Declares one tool in MCP's wire shape, ready to return from a `tools/list`
 * response.
 *
 * @property name Tool identifier the client calls, e.g. `aleo_get_balance`.
 * @property description What the model reads to decide when to call the tool.
 * @property inputSchema JSON Schema for the tool's arguments.
 */
export type McpToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/**
 * Transport-agnostic MCP server surface: the tool list plus a dispatcher.
 *
 * This is not a running process — the caller wires it into an MCP SDK server:
 * serve `tools` from `tools/list` and route `tools/call` to `handleToolCall`
 * over any transport (stdio, HTTP).
 *
 * @property tools Tool declarations to return from `tools/list`.
 * @property handleToolCall Dispatches a call by tool name and resolves to the
 *   tool's structured JSON result; rejects on an unknown name.
 */
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
 *
 * Construction is pure and local; the handlers reach the network through the
 * configured clients only when a tool is invoked, and wallet-backed tools
 * sign and pay fees. This returns the tool list and dispatcher — binding a
 * transport (stdio, HTTP) is the caller's job.
 *
 * @param config Clients that select the tool set: `client` enables the
 *   read-only tools, `walletClient` enables the write tools.
 * @returns An {@link McpServer} serving the enabled tools.
 *
 * @example
 * import { createPublicClient, http } from '@veil/core'
 * import { createMcpServer } from '@veil/core/mcp'
 *
 * const client = createPublicClient({
 *   transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
 * })
 * const server = createMcpServer({ client })
 * // Wire into an MCP transport: list server.tools, route calls to
 * // server.handleToolCall(name, input).
 */
export function createMcpServer(config: McpServerConfig): McpServer {
  return toMcpServer(createAgentTools(config))
}
