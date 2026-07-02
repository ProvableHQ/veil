import type { Client } from '@veil/core'
import type { AgentToolHandler } from '@veil/core/agent'
import type { ApiClient } from '../api/client.js'
import { getPool } from '../actions/reads/getPool.js'
import { getSlot } from '../actions/reads/getSlot.js'
import { getSwapOutput } from '../actions/reads/getSwapOutput.js'
import { isPoolInitialized, getFeeToTickSpacing } from '../actions/reads/validation.js'
import { getPrivateBalances } from '../utils/records.js'
import { getBalances } from '../utils/balances.js'

/**
 * Recursively converts `bigint` values to strings so a tool result is safe to
 * `JSON.stringify`. Decoded pool/slot/balance objects carry u64/u128 fields as
 * bigint, which JSON cannot serialize — an agent runtime needs plain JSON.
 */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]))
  }
  return value
}

/** Chain-direct + private-balance handlers, keyed by tool name. */
export function createChainHandlers(client: Client, program?: string): Record<string, AgentToolHandler> {
  return {
    shield_swap_get_pool: async (i) =>
      jsonSafe(await getPool(client, { poolKey: i.poolKey as string, program })),
    shield_swap_get_slot: async (i) =>
      jsonSafe(await getSlot(client, { poolKey: i.poolKey as string, program })),
    shield_swap_get_swap_output: async (i) =>
      jsonSafe(await getSwapOutput(client, { swapId: i.swapId as string, program })),
    shield_swap_is_pool_initialized: async (i) => ({
      initialized: await isPoolInitialized(client, { poolKey: i.poolKey as string, program }),
    }),
    shield_swap_get_fee_tick_spacing: async (i) => ({
      tickSpacing: await getFeeToTickSpacing(client, { fee: i.fee as number, program }),
    }),
    shield_swap_get_private_balances: async (i) =>
      jsonSafe(await getPrivateBalances(client, { programs: i.programs as string[] })),
  }
}

/** Off-chain DEX API handlers, keyed by tool name. */
export function createApiHandlers(api: ApiClient): Record<string, AgentToolHandler> {
  return {
    shield_swap_list_pools: async (i) =>
      api.getPools({ limit: i.limit as number | undefined, offset: i.offset as number | undefined }),
    shield_swap_get_route: async (i) =>
      api.getRoute({
        token_in: i.tokenIn as string,
        token_out: i.tokenOut as string,
        amount_in: i.amountIn !== undefined ? BigInt(i.amountIn as string) : undefined,
      }),
    shield_swap_list_tokens: async () => api.getTokens(),
    shield_swap_get_public_balances: async (i) => api.getPublicBalances({ user: i.user as string }),
  }
}

/** Composed (client + API) handlers, keyed by tool name. */
export function createComposedHandlers(client: Client, api: ApiClient): Record<string, AgentToolHandler> {
  return {
    shield_swap_get_balances: async (i) =>
      jsonSafe(
        await getBalances(client, api, {
          user: i.user as string | undefined,
          tokens: i.tokens as string[] | undefined,
        }),
      ),
  }
}
