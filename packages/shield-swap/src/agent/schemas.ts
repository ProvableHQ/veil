import type { AgentToolSchema } from '@veil/core/agent'

// ---------------------------------------------------------------------------
// Chain-direct read tools (backed by a Veil client). Trust-critical values —
// they come from the node, not the off-chain API.
// ---------------------------------------------------------------------------

const poolKeyProp = {
  poolKey: { type: 'string', description: 'Pool key field literal, e.g. "4719…024field".' },
}

/** Declares the `shield_swap_get_pool` tool — a chain-direct read of a pool's static configuration (backed by `getPool`). */
export const getPoolSchema: AgentToolSchema = {
  name: 'shield_swap_get_pool',
  description:
    "Read a pool's static configuration from chain — the token pair, fee tier, " +
    'and decimal scales. Returns null when the pool does not exist.',
  inputSchema: { type: 'object', properties: poolKeyProp, required: ['poolKey'] },
}

/** Declares the `shield_swap_get_slot` tool — a chain-direct read of a pool's live trading state (backed by `getSlot`). */
export const getSlotSchema: AgentToolSchema = {
  name: 'shield_swap_get_slot',
  description:
    "Read a pool's live trading state from chain — current tick, Q64 sqrt price, " +
    'in-range liquidity, and tick spacing. Returns null when the pool has no slot.',
  inputSchema: { type: 'object', properties: poolKeyProp, required: ['poolKey'] },
}

/** Declares the `shield_swap_get_swap_output` tool — a chain-direct read of a finalized swap's output (backed by `getSwapOutput`). */
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

/** Declares the `shield_swap_is_pool_initialized` tool — a chain-direct pool-existence check (backed by `isPoolInitialized`). */
export const isPoolInitializedSchema: AgentToolSchema = {
  name: 'shield_swap_is_pool_initialized',
  description: 'Check whether a pool exists (is initialized) for a pool key. Returns a boolean.',
  inputSchema: { type: 'object', properties: poolKeyProp, required: ['poolKey'] },
}

/** Declares the `shield_swap_get_fee_tick_spacing` tool — a chain-direct fee-tier to tick-spacing lookup (backed by `getFeeToTickSpacing`). */
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

/** Declares the `shield_swap_get_private_balances` tool — sums the caller's unspent token records per program (backed by `getPrivateBalances`). */
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

/** Declares the `shield_swap_list_pools` tool — a paginated pool listing from the DEX API (backed by `ApiClient.getPools`). */
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

/** Declares the `shield_swap_get_route` tool — a best-route quote from the DEX API (backed by `ApiClient.getRoute`); its output feeds the swap tool's `expectedOut`. */
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

/** Declares the `shield_swap_list_tokens` tool — the DEX API's token registry (backed by `ApiClient.getTokens`). */
export const listTokensSchema: AgentToolSchema = {
  name: 'shield_swap_list_tokens',
  description: 'List all tokens the DEX API knows, with symbol, decimals, and wrapper program.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}

/** Declares the `shield_swap_get_public_balances` tool — an address's public/authorized balances from the DEX API (backed by `ApiClient.getPublicBalances`). */
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

/** Declares the `shield_swap_get_balances` tool — public + private + total balances per token, joining the DEX API with the caller's records (backed by `getBalances`). */
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

// ---------------------------------------------------------------------------
// Write tools (money-moving; local-signer path). Handlers auto-fetch the
// dynamic-dispatch program sources and, on the local path, auto-select records
// — so amounts and token programs are all the caller passes. Amounts are
// strings (raw base units, u128).
// ---------------------------------------------------------------------------

/** Declares the `shield_swap_create_pool` write tool — creates a pool for a token pair (a public, fee-costing transaction; backed by `createPool`). */
export const createPoolSchema: AgentToolSchema = {
  name: 'shield_swap_create_pool',
  description:
    'Create a pool for a token pair at a fee tier (a public transaction). Returns the pool ' +
    'key and transaction id. The fee tier must be registered on chain (validated first).',
  inputSchema: {
    type: 'object',
    properties: {
      token0ProgramId: { type: 'string', description: 'First token id (field literal). Order does not matter.' },
      token1ProgramId: { type: 'string', description: 'Second token id (field literal).' },
      fee: { type: 'number', description: 'Fee tier in pips (u16), e.g. 3000 = 0.30%.' },
      initialTick: { type: 'number', description: 'Opening tick; sets the initial price.' },
    },
    required: ['token0ProgramId', 'token1ProgramId', 'fee', 'initialTick'],
  },
}

/** Declares the `shield_swap_swap` write tool — phase one of a private swap; returns the handle `shield_swap_claim` consumes (backed by `swap`). */
export const swapSchema: AgentToolSchema = {
  name: 'shield_swap_swap',
  description:
    'Request a private swap (phase one). Returns a swap handle to pass to shield_swap_claim ' +
    'once the request finalizes. Pass a quoted expectedOut (from shield_swap_get_route) so ' +
    'slippage protection is meaningful.',
  inputSchema: {
    type: 'object',
    properties: {
      poolKey: { type: 'string', description: 'Pool key field literal.' },
      tokenInId: { type: 'string', description: 'Token id being sold (field literal); one of the pool tokens.' },
      amountIn: { type: 'string', description: 'Amount to sell, raw base units (u128) as a string.' },
      tokenInProgram: { type: 'string', description: "The input token's wrapper program (holds your records)." },
      tokenOutProgram: { type: 'string', description: "The output token's wrapper program." },
      expectedOut: { type: 'string', description: 'Quoted output (u128 string) for slippage. Optional.' },
      slippageBps: { type: 'number', description: 'Slippage tolerance in basis points. Defaults to 50 (0.5%).' },
    },
    required: ['poolKey', 'tokenInId', 'amountIn', 'tokenInProgram', 'tokenOutProgram'],
  },
}

/** Declares the `shield_swap_claim` write tool — phase two of a private swap; collects the finalized output as private records (backed by `claimSwapOutput`). */
export const claimSchema: AgentToolSchema = {
  name: 'shield_swap_claim',
  description:
    'Claim a finalized private swap (phase two), collecting the output as private records. ' +
    'Retry if it reports the output is not finalized yet.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: { type: 'object', description: 'The swap handle returned by shield_swap_swap.' },
      tokenInProgram: { type: 'string', description: "The input token's wrapper program." },
      tokenOutProgram: { type: 'string', description: "The output token's wrapper program." },
    },
    required: ['handle', 'tokenInProgram', 'tokenOutProgram'],
  },
}

/** Declares the `shield_swap_mint` write tool — mints a concentrated-liquidity position over a tick range (backed by `mint`). */
export const mintSchema: AgentToolSchema = {
  name: 'shield_swap_mint',
  description:
    'Mint a concentrated-liquidity position over a tick range. Ticks are rounded to the ' +
    "pool's spacing. Returns the position token id.",
  inputSchema: {
    type: 'object',
    properties: {
      poolKey: { type: 'string', description: 'Pool key field literal.' },
      tickLower: { type: 'number', description: 'Lower tick of the range.' },
      tickUpper: { type: 'number', description: 'Upper tick of the range.' },
      amount0Desired: { type: 'string', description: 'Desired token0 amount, raw base units (u128) string.' },
      amount1Desired: { type: 'string', description: 'Desired token1 amount, raw base units (u128) string.' },
      token0Program: { type: 'string', description: "token0's wrapper program." },
      token1Program: { type: 'string', description: "token1's wrapper program." },
    },
    required: ['poolKey', 'tickLower', 'tickUpper', 'amount0Desired', 'amount1Desired', 'token0Program', 'token1Program'],
  },
}

/** Declares the `shield_swap_increase_liquidity` write tool — deepens the caller's existing position without changing its tick range (backed by `increaseLiquidity`). */
export const increaseLiquiditySchema: AgentToolSchema = {
  name: 'shield_swap_increase_liquidity',
  description: 'Add funds to your existing position in a pool (tick range unchanged).',
  inputSchema: {
    type: 'object',
    properties: {
      poolKey: { type: 'string', description: 'Pool key field literal.' },
      amount0Desired: { type: 'string', description: 'Additional token0 amount, raw base units (u128) string.' },
      amount1Desired: { type: 'string', description: 'Additional token1 amount, raw base units (u128) string.' },
      token0Program: { type: 'string', description: "token0's wrapper program." },
      token1Program: { type: 'string', description: "token1's wrapper program." },
    },
    required: ['poolKey', 'amount0Desired', 'amount1Desired', 'token0Program', 'token1Program'],
  },
}

/** Declares the `shield_swap_decrease_liquidity` write tool — removes liquidity from the caller's position into `tokens_owed` without moving tokens (backed by `decreaseLiquidity`). */
export const decreaseLiquiditySchema: AgentToolSchema = {
  name: 'shield_swap_decrease_liquidity',
  description:
    'Remove liquidity from your existing position. No tokens move — the withdrawn principal and ' +
    'accrued fees settle into the position, collectable with shield_swap_collect.',
  inputSchema: {
    type: 'object',
    properties: {
      poolKey: { type: 'string', description: 'Pool key field literal.' },
      liquidityToRemove: { type: 'string', description: 'Liquidity units to remove, raw (u128) string.' },
      amount0Min: { type: 'string', description: 'Minimum token0 credited (slippage guard, u128 string). Optional.' },
      amount1Min: { type: 'string', description: 'Minimum token1 credited (u128 string). Optional.' },
    },
    required: ['poolKey', 'liquidityToRemove'],
  },
}

/** Declares the `shield_swap_collect` write tool — withdraws a position's owed tokens as private records (backed by `collect`). */
export const collectSchema: AgentToolSchema = {
  name: 'shield_swap_collect',
  description:
    "Withdraw a position's owed tokens as private records to your address. Amounts are capped " +
    'on chain at the owed balance.',
  inputSchema: {
    type: 'object',
    properties: {
      poolKey: { type: 'string', description: 'Pool key field literal.' },
      amount0Requested: { type: 'string', description: 'token0 to withdraw, raw base units (u128) string.' },
      amount1Requested: { type: 'string', description: 'token1 to withdraw, raw base units (u128) string.' },
      token0Program: { type: 'string', description: "token0's wrapper program." },
      token1Program: { type: 'string', description: "token1's wrapper program." },
    },
    required: ['poolKey', 'amount0Requested', 'amount1Requested', 'token0Program', 'token1Program'],
  },
}

/** Declares the `shield_swap_burn` write tool — closes a fully-drained position by consuming its PositionNFT (backed by `burn`). */
export const burnSchema: AgentToolSchema = {
  name: 'shield_swap_burn',
  description:
    'Close a position by burning its NFT. The position must first be drained to zero liquidity ' +
    '(shield_swap_decrease_liquidity) and zero owed tokens (shield_swap_collect).',
  inputSchema: {
    type: 'object',
    properties: {
      poolKey: { type: 'string', description: 'Pool key field literal.' },
      positionTokenId: { type: 'string', description: 'The position token id to burn. Optional on the local path.' },
    },
    required: ['poolKey'],
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

/** Money-moving write tools — require a client, and are opt-in (`includeWrites`). */
export const writeToolSchemas: AgentToolSchema[] = [
  createPoolSchema,
  swapSchema,
  claimSchema,
  mintSchema,
  increaseLiquiditySchema,
  decreaseLiquiditySchema,
  collectSchema,
  burnSchema,
]
