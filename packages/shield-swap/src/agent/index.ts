import type { AgentTool, AgentToolSchema } from '@veil/core/agent'
import type { ShieldSwapAgentToolsConfig } from './types.js'
import { chainToolSchemas, apiToolSchemas, composedToolSchemas } from './schemas.js'
import { createChainHandlers, createApiHandlers, createComposedHandlers } from './handlers.js'

export type { ShieldSwapAgentToolsConfig, AgentTool, AgentToolSchema, AgentToolHandler } from './types.js'
export {
  chainToolSchemas,
  apiToolSchemas,
  composedToolSchemas,
  getPoolSchema,
  getSlotSchema,
  getSwapOutputSchema,
  isPoolInitializedSchema,
  getFeeToTickSpacingSchema,
  getPrivateBalancesSchema,
  listPoolsSchema,
  getRouteSchema,
  listTokensSchema,
  getPublicBalancesSchema,
  getBalancesSchema,
} from './schemas.js'

/**
 * Returns the shield_swap agent-tool schemas (definitions only, no handlers).
 *
 * For registering tool names/descriptions with an LLM without wiring
 * execution. The set reflects what the config could back: chain tools when a
 * `client` is given, API tools when an `api` is given, composed tools when
 * both are. With no config, returns every schema.
 *
 * @param config Optional wiring; gates which tool groups are included.
 * @returns The matching {@link AgentToolSchema}s. Pure and local.
 *
 * @example
 * const schemas = shieldSwapAgentToolSchemas() // all of them
 */
export function shieldSwapAgentToolSchemas(config?: ShieldSwapAgentToolsConfig): AgentToolSchema[] {
  const all = !config
  const schemas: AgentToolSchema[] = []
  if (all || config.client) schemas.push(...chainToolSchemas)
  if (all || config.api) schemas.push(...apiToolSchemas)
  if (all || (config.client && config.api)) schemas.push(...composedToolSchemas)
  return schemas
}

/**
 * Builds executable shield_swap agent tools (schema + handler).
 *
 * Framework-agnostic {@link AgentTool}s — the same shape as `@veil/core`'s
 * `createAgentTools`, so DEX and base-Aleo tools register together (LangChain,
 * Vercel AI SDK, the MCP server). Only tool groups whose backing is present
 * are included: chain + private-balance tools need `client`, API tools need
 * `api`, and `shield_swap_get_balances` needs both.
 *
 * Handlers hit the network when invoked; results are JSON-safe (bigints
 * rendered as strings).
 *
 * @param config The client and/or API client to bind, and the default program.
 * @returns The bound tools.
 *
 * @example
 * const client = walletClient.extend(shieldSwapActions({ api: {} }))
 * const tools = createShieldSwapAgentTools({ client, api: client.api })
 */
export function createShieldSwapAgentTools(config: ShieldSwapAgentToolsConfig): AgentTool[] {
  const tools: AgentTool[] = []
  const add = (schemas: AgentToolSchema[], handlers: Record<string, (p: Record<string, unknown>) => Promise<unknown>>) => {
    for (const schema of schemas) tools.push({ schema, handler: handlers[schema.name]! })
  }

  if (config.client) add(chainToolSchemas, createChainHandlers(config.client, config.program))
  if (config.api) add(apiToolSchemas, createApiHandlers(config.api))
  if (config.client && config.api) add(composedToolSchemas, createComposedHandlers(config.client, config.api))
  return tools
}
