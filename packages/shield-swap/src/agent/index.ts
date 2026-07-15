import type { AgentTool, AgentToolSchema } from '@provablehq/veil-core/agent'
import type { ShieldSwapAgentToolsConfig } from './types.js'
import {
  chainToolSchemas,
  apiToolSchemas,
  composedToolSchemas,
  authToolSchemas,
  writeToolSchemas,
  pureToolSchemas,
} from './schemas.js'
import {
  createChainHandlers,
  createApiHandlers,
  createComposedHandlers,
  createAuthHandlers,
  createWriteHandlers,
  createPureHandlers,
} from './handlers.js'

export type { ShieldSwapAgentToolsConfig, AgentTool, AgentToolSchema, AgentToolHandler } from './types.js'
export {
  chainToolSchemas,
  apiToolSchemas,
  composedToolSchemas,
  authToolSchemas,
  writeToolSchemas,
  pureToolSchemas,
  getPoolSchema,
  getSlotSchema,
  getSwapOutputSchema,
  getPositionSchema,
  getTickSchema,
  getTradeControlsSchema,
  getFrozenPositionSchema,
  getTokenDecimalsSchema,
  isPoolCreationOpenSchema,
  isPoolInitializedSchema,
  getFeeToTickSpacingSchema,
  getPrivateBalancesSchema,
  derivePoolKeySchema,
  deriveTickKeySchema,
  deriveSwapIdSchema,
  derivePositionTokenIdSchema,
  deriveMultiHopSwapIdSchema,
  listPoolsSchema,
  getRouteSchema,
  listTokensSchema,
  getPublicBalancesSchema,
  getBalancesSchema,
  authenticateSchema,
  getAccessStatusSchema,
  redeemAccessCodeSchema,
  createApiTokenSchema,
  listApiTokensSchema,
  revokeApiTokenSchema,
} from './schemas.js'

/**
 * Returns the shield_swap agent-tool schemas (definitions only, no handlers).
 *
 * For registering tool names/descriptions with an LLM without wiring
 * execution. The pure derivation tools (pool/tick keys, swap and position
 * ids) are always included — they need no backing. The rest reflects what
 * the config could back: chain tools when a `client` is given, API tools
 * when an `api` is given, composed tools when both are. With no config,
 * returns every schema.
 *
 * @param config Optional wiring; gates which tool groups are included.
 * @returns The matching {@link AgentToolSchema}s. Pure and local.
 *
 * @example
 * const schemas = shieldSwapAgentToolSchemas() // all of them
 */
export function shieldSwapAgentToolSchemas(config?: ShieldSwapAgentToolsConfig): AgentToolSchema[] {
  const all = !config
  // Pure derivations need no backing — always available.
  const schemas: AgentToolSchema[] = [...pureToolSchemas]
  if (all || config.client) schemas.push(...chainToolSchemas)
  if (all || config.api) schemas.push(...apiToolSchemas)
  if (all || (config.client && config.api)) schemas.push(...composedToolSchemas, ...authToolSchemas)
  // Writes are money-moving — included only when explicitly opted in.
  if (all || (config.includeWrites && config.client)) schemas.push(...writeToolSchemas)
  return schemas
}

/**
 * Builds executable shield_swap agent tools (schema + handler).
 *
 * Framework-agnostic {@link AgentTool}s — the same shape as `@provablehq/veil-core`'s
 * `createAgentTools`, so DEX and base-Aleo tools register together (LangChain,
 * Vercel AI SDK, the MCP server). The pure derivation tools are always
 * included; the other groups appear only when their backing is present:
 * chain + private-balance tools need `client`, API tools need `api`, and
 * `shield_swap_get_balances` needs both.
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

  // Pure derivations need no backing — always available.
  add(pureToolSchemas, createPureHandlers())
  if (config.client) add(chainToolSchemas, createChainHandlers(config.client, config.program))
  if (config.api) add(apiToolSchemas, createApiHandlers(config.api))
  if (config.client && config.api) {
    add(composedToolSchemas, createComposedHandlers(config.client, config.api))
    add(authToolSchemas, createAuthHandlers(config.client, config.api))
  }
  if (config.includeWrites && config.client) add(writeToolSchemas, createWriteHandlers(config.client, config.program))
  return tools
}
