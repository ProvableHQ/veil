import type { AgentToolSchema } from '@veil/core/agent'

// ---------------------------------------------------------------------------
// Chain-direct read tools (backed by a Veil client). Trust-critical values —
// they come from the node, not the off-chain API.
// ---------------------------------------------------------------------------

const poolKeyProp = {
  poolKey: { type: 'string', description: 'Pool key field literal, e.g. "4719…024field".' },
}

export const getPoolSchema: AgentToolSchema = {
  name: 'shield_swap_get_pool',
  description:
    "Read a pool's static configuration from chain — the token pair, fee tier, " +
    'and decimal scales. Returns null when the pool does not exist.',
  inputSchema: { type: 'object', properties: poolKeyProp, required: ['poolKey'] },
}

export const getSlotSchema: AgentToolSchema = {
  name: 'shield_swap_get_slot',
  description:
    "Read a pool's live trading state from chain — current tick, Q64 sqrt price, " +
    'in-range liquidity, and tick spacing. Returns null when the pool has no slot.',
  inputSchema: { type: 'object', properties: poolKeyProp, required: ['poolKey'] },
}

export const getSwapOutputSchema: AgentToolSchema = {
  name: 'shield_swap_get_swap_output',
  description:
    'Read a finalized private-swap output from chain by its swap id (the amount the ' +
    'chain computed, to be claimed). Returns null before finalize or after the claim consumes it.',
  inputSchema: {
    type: 'object',
    properties: { swapId: { type: 'string', description: 'Swap id field literal from the swap handle.' } },
    required: ['swapId'],
  },
}

export const isPoolInitializedSchema: AgentToolSchema = {
  name: 'shield_swap_is_pool_initialized',
  description: 'Check whether a pool exists (is initialized) for a pool key. Returns a boolean.',
  inputSchema: { type: 'object', properties: poolKeyProp, required: ['poolKey'] },
}

export const getFeeToTickSpacingSchema: AgentToolSchema = {
  name: 'shield_swap_get_fee_tick_spacing',
  description:
    'Read the canonical tick spacing bound to a fee tier on chain. Returns the spacing ' +
    '(number) or null when the fee is unregistered.',
  inputSchema: {
    type: 'object',
    properties: { fee: { type: 'number', description: 'Fee tier in pips (u16), e.g. 3000 = 0.30%.' } },
    required: ['fee'],
  },
}

export const getPrivateBalancesSchema: AgentToolSchema = {
  name: 'shield_swap_get_private_balances',
  description:
    "Sum the caller's own unspent token records per program — the private balance they can " +
    'spend. Amounts are raw base-unit strings. Needs the caller\'s record provider.',
  inputSchema: {
    type: 'object',
    properties: {
      programs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Token programs to scan (wrapper programs), e.g. ["ethx_5a095e.aleo"].',
      },
    },
    required: ['programs'],
  },
}

// ---------------------------------------------------------------------------
// Off-chain DEX API read tools (backed by the ApiClient).
// ---------------------------------------------------------------------------

export const listPoolsSchema: AgentToolSchema = {
  name: 'shield_swap_list_pools',
  description: 'List pools from the DEX API with token metadata (paginated).',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max pools to return.' },
      offset: { type: 'number', description: 'Pagination offset.' },
    },
    required: [],
  },
}

export const getRouteSchema: AgentToolSchema = {
  name: 'shield_swap_get_route',
  description:
    'Quote the best route between two tokens (≤ 3 hops) from the DEX API. Use the quoted ' +
    'output as the expected amount for a swap. token ids are field literals.',
  inputSchema: {
    type: 'object',
    properties: {
      tokenIn: { type: 'string', description: 'Input token id (field literal).' },
      tokenOut: { type: 'string', description: 'Output token id (field literal).' },
      amountIn: { type: 'string', description: 'Optional input amount, raw base units (u128) as a string.' },
    },
    required: ['tokenIn', 'tokenOut'],
  },
}

export const listTokensSchema: AgentToolSchema = {
  name: 'shield_swap_list_tokens',
  description: 'List all tokens the DEX API knows, with symbol, decimals, and wrapper program.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}

export const getPublicBalancesSchema: AgentToolSchema = {
  name: 'shield_swap_get_public_balances',
  description:
    "Read an address's public/authorized token balances from the DEX API. Raw base-unit " +
    'strings. This is the public counterpart to shield_swap_get_private_balances.',
  inputSchema: {
    type: 'object',
    properties: { user: { type: 'string', description: 'Address to read balances for (aleo1…).' } },
    required: ['user'],
  },
}

// ---------------------------------------------------------------------------
// Composed (needs both client and API).
// ---------------------------------------------------------------------------

export const getBalancesSchema: AgentToolSchema = {
  name: 'shield_swap_get_balances',
  description:
    'Report public, private, and total balances per token for an address by joining the DEX ' +
    'API balances with the caller\'s records. Defaults to the client\'s account. Amounts are ' +
    'raw base-unit strings.',
  inputSchema: {
    type: 'object',
    properties: {
      user: { type: 'string', description: 'Address override (aleo1…). Defaults to the client account.' },
      tokens: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional token ids (field literals) to restrict to; reports these exactly, else held tokens.',
      },
    },
    required: [],
  },
}

/** Chain-direct + private-balance tools — require a client. */
export const chainToolSchemas: AgentToolSchema[] = [
  getPoolSchema,
  getSlotSchema,
  getSwapOutputSchema,
  isPoolInitializedSchema,
  getFeeToTickSpacingSchema,
  getPrivateBalancesSchema,
]

/** Off-chain DEX API tools — require an ApiClient. */
export const apiToolSchemas: AgentToolSchema[] = [
  listPoolsSchema,
  getRouteSchema,
  listTokensSchema,
  getPublicBalancesSchema,
]

/** Composed tools — require both a client and an ApiClient. */
export const composedToolSchemas: AgentToolSchema[] = [getBalancesSchema]
