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
 * Exposed via subpath export: import { aleoAgentTools } from '@aleo-viem/core/agent'
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
