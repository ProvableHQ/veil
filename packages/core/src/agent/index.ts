export type {
  AgentToolSchema,
  AgentToolHandler,
  AgentTool,
  AgentToolDefinition,
  AgentToolsConfig,
} from './types.js'

export {
  publicToolSchemas,
  walletToolSchemas,
  allToolSchemas,
} from './schemas.js'

import type { AgentToolDefinition, AgentToolsConfig, AgentTool, AgentToolSchema } from './types.js'
import { publicToolSchemas, walletToolSchemas } from './schemas.js'
import { createPublicHandlers } from './handlers.js'
import { createWalletHandlers } from './handlers.js'

/**
 * Returns just the tool schemas (no handlers).
 * Useful for consumers that only need the definitions — e.g. to register
 * tool names/descriptions with an LLM without wiring up execution.
 *
 * Pure and local — no client is required and nothing is called.
 *
 * @param config Optional filter: with `client` set the read-only schemas are
 *   included, with `walletClient` set the write schemas are included. When
 *   omitted entirely, all schemas are returned.
 * @returns The schemas for the selected tool sets, read-only first.
 */
export function aleoAgentToolSchemas(config?: AgentToolsConfig): AgentToolSchema[] {
  const schemas: AgentToolSchema[] = []
  if (!config || config.client) schemas.push(...publicToolSchemas)
  if (!config || config.walletClient) schemas.push(...walletToolSchemas)
  return schemas
}

/**
 * Returns AgentTool[] with both schema and handler for all available actions.
 * Framework-agnostic — can be consumed by LangChain, Vercel AI SDK, etc.
 *
 * Exposed via subpath export: import { aleoAgentTools } from '@provablehq/veil-core/agent'
 *
 * Construction is pure and local; each tool's handler reaches the network
 * through the configured client when the agent invokes it, and wallet-backed
 * tools sign and pay fees.
 *
 * @param config Clients that select the tool set: `client` enables the
 *   read-only tools, `walletClient` enables the write tools. Omitting one
 *   omits its tools.
 * @returns One flat definition per enabled tool, ready to register with an
 *   agent framework.
 *
 * @example
 * import { createPublicClient, http } from '@provablehq/veil-core'
 * import { aleoAgentTools } from '@provablehq/veil-core/agent'
 *
 * const client = createPublicClient({
 *   transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
 * })
 * const tools = aleoAgentTools({ client })
 * // Register each tool's name/description/inputSchema with the agent framework
 * // and route calls to tool.handler(input).
 */
export function aleoAgentTools(config: AgentToolsConfig): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = []

  if (config.client) {
    const handlers = createPublicHandlers(config.client)
    for (const schema of publicToolSchemas) {
      tools.push({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        handler: handlers[schema.name]!,
      })
    }
  }

  if (config.walletClient) {
    const handlers = createWalletHandlers(config.walletClient)
    for (const schema of walletToolSchemas) {
      tools.push({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        handler: handlers[schema.name]!,
      })
    }
  }

  return tools
}

/**
 * Returns AgentTool[] with the new schema+handler shape.
 * Identical to aleoAgentTools but uses the AgentTool type
 * with schema and handler as separate top-level fields.
 */
export function createAgentTools(config: AgentToolsConfig): AgentTool[] {
  const defs = aleoAgentTools(config)
  return defs.map((def) => ({
    schema: {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema as AgentToolSchema['inputSchema'],
    },
    handler: def.handler,
  }))
}
