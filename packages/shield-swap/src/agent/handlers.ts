import type { Client } from '@provablehq/veil-core'
import { getProgram } from '@provablehq/veil-core'
import type { AgentToolHandler } from '@provablehq/veil-core/agent'
import type { ApiClient } from '../api/client.js'
import { getPool } from '../actions/reads/getPool.js'
import { getSlot } from '../actions/reads/getSlot.js'
import { getSwapOutput } from '../actions/reads/getSwapOutput.js'
import { isPoolInitialized, getFeeToTickSpacing } from '../actions/reads/validation.js'
import { getPrivateBalances } from '../utils/records.js'
import { getBalances } from '../utils/balances.js'
import { swap } from '../actions/swap/swap.js'
import { claimSwapOutput } from '../actions/swap/claimSwapOutput.js'
import type { SwapHandle } from '../actions/swap/swap.js'
import { createPool } from '../actions/liquidity/createPool.js'
import { mint } from '../actions/liquidity/mint.js'
import { increaseLiquidity } from '../actions/liquidity/increaseLiquidity.js'
import { decreaseLiquidity } from '../actions/liquidity/decreaseLiquidity.js'
import { collect } from '../actions/liquidity/collect.js'
import { burn } from '../actions/liquidity/burn.js'

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

/**
 * Fetches sources for the given token programs into an `imports` map. The
 * prover can't discover the `IARC20@(…)` dynamic-dispatch callees statically,
 * so writes need them — the agent shouldn't hand-author program sources, so
 * the handlers fetch them here.
 */
async function fetchImports(client: Client, programs: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(programs)]
  const entries = await Promise.all(
    unique.map(async (programId) => [programId, await getProgram(client, { programId })] as const),
  )
  return Object.fromEntries(entries)
}

/** Money-moving write handlers (local-signer path), keyed by tool name. */
export function createWriteHandlers(client: Client, program?: string): Record<string, AgentToolHandler> {
  return {
    shield_swap_create_pool: async (i) =>
      jsonSafe(
        await createPool(client, {
          token0ProgramId: i.token0ProgramId as string,
          token1ProgramId: i.token1ProgramId as string,
          fee: i.fee as number,
          initialTick: i.initialTick as number,
          program,
        }),
      ),

    shield_swap_swap: async (i) => {
      const imports = await fetchImports(client, [i.tokenInProgram as string, i.tokenOutProgram as string])
      return jsonSafe(
        await swap(client, {
          poolKey: i.poolKey as string,
          tokenInId: i.tokenInId as string,
          amountIn: BigInt(i.amountIn as string),
          tokenInProgram: i.tokenInProgram as string,
          expectedOut: i.expectedOut !== undefined ? BigInt(i.expectedOut as string) : undefined,
          slippageBps: i.slippageBps as number | undefined,
          imports,
          program,
        }),
      )
    },

    shield_swap_claim: async (i) => {
      const imports = await fetchImports(client, [i.tokenInProgram as string, i.tokenOutProgram as string])
      // The handle keeps its own program; do not override it with the config default.
      return jsonSafe(await claimSwapOutput(client, { handle: i.handle as unknown as SwapHandle, imports }))
    },

    shield_swap_mint: async (i) => {
      const imports = await fetchImports(client, [i.token0Program as string, i.token1Program as string])
      return jsonSafe(
        await mint(client, {
          poolKey: i.poolKey as string,
          tickLower: i.tickLower as number,
          tickUpper: i.tickUpper as number,
          amount0Desired: BigInt(i.amount0Desired as string),
          amount1Desired: BigInt(i.amount1Desired as string),
          token0Program: i.token0Program as string,
          token1Program: i.token1Program as string,
          imports,
          program,
        }),
      )
    },

    shield_swap_increase_liquidity: async (i) => {
      const imports = await fetchImports(client, [i.token0Program as string, i.token1Program as string])
      return jsonSafe(
        await increaseLiquidity(client, {
          poolKey: i.poolKey as string,
          amount0Desired: BigInt(i.amount0Desired as string),
          amount1Desired: BigInt(i.amount1Desired as string),
          token0Program: i.token0Program as string,
          token1Program: i.token1Program as string,
          imports,
          program,
        }),
      )
    },

    shield_swap_decrease_liquidity: async (i) =>
      jsonSafe(
        await decreaseLiquidity(client, {
          poolKey: i.poolKey as string,
          liquidityToRemove: BigInt(i.liquidityToRemove as string),
          amount0Min: i.amount0Min !== undefined ? BigInt(i.amount0Min as string) : undefined,
          amount1Min: i.amount1Min !== undefined ? BigInt(i.amount1Min as string) : undefined,
          program,
        }),
      ),

    shield_swap_collect: async (i) => {
      const imports = await fetchImports(client, [i.token0Program as string, i.token1Program as string])
      return jsonSafe(
        await collect(client, {
          poolKey: i.poolKey as string,
          amount0Requested: BigInt(i.amount0Requested as string),
          amount1Requested: BigInt(i.amount1Requested as string),
          imports,
          program,
        }),
      )
    },

    shield_swap_burn: async (i) =>
      jsonSafe(
        await burn(client, {
          poolKey: i.poolKey as string,
          positionTokenId: i.positionTokenId as string | undefined,
          program,
        }),
      ),
  }
}
