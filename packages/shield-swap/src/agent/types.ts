import type { Client } from '@veil/core'
import type { AgentToolSchema, AgentTool, AgentToolHandler } from '@veil/core/agent'
import type { ApiClient } from '../api/client.js'

// Reuse core's agent-tool contract so shield_swap tools compose into the same
// registries (LangChain, Vercel AI SDK, the MCP server) as the base Aleo tools.
export type { AgentToolSchema, AgentTool, AgentToolHandler } from '@veil/core/agent'

/**
 * Wiring for the shield_swap agent tools.
 *
 * @property client A Veil client (public or wallet) for chain-direct reads and
 *   record-derived balances. Chain and private-balance tools are available
 *   only when this is set.
 * @property api The DEX API client for off-chain reads (pools, routes, tokens,
 *   public balances). API tools are available only when this is set.
 * @property program shield_swap program id the chain tools default to.
 *   Defaults to `DEFAULT_PROGRAM` (the live deployment).
 */
export type ShieldSwapAgentToolsConfig = {
  client?: Client
  api?: ApiClient
  program?: string
}

/** A schema plus the handler that executes it — the internal registry entry. */
export type AgentToolEntry = { schema: AgentToolSchema; handler: AgentToolHandler }
