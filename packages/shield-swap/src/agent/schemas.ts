import type { AgentToolSchema } from '@provablehq/veil-core/agent'

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

/** Declares the `shield_swap_get_position` tool — a chain-direct read of a position's public state (backed by `getPosition`). */
export const getPositionSchema: AgentToolSchema = {
  name: 'shield_swap_get_position',
  description:
    "Read a position's public state from chain by its token id — range, live liquidity, " +
    'and the tokens_owed balances collectable with shield_swap_collect. Returns null when ' +
    'no position exists under the id.',
  inputSchema: {
    type: 'object',
    properties: {
      positionTokenId: { type: 'string', description: 'Position token id field literal (from mint or a PositionNFT).' },
    },
    required: ['positionTokenId'],
  },
}

/** Declares the `shield_swap_get_tick` tool — a chain-direct read of an initialized tick (backed by `getTick`). */
export const getTickSchema: AgentToolSchema = {
  name: 'shield_swap_get_tick',
  description:
    'Read an initialized tick from chain — net/gross liquidity, fee-growth-outside ' +
    'snapshots, and its prev/next neighbors. Returns null for an uninitialized tick.',
  inputSchema: {
    type: 'object',
    properties: {
      ...poolKeyProp,
      tick: { type: 'number', description: 'Tick index (i32).' },
    },
    required: ['poolKey', 'tick'],
  },
}

/** Declares the `shield_swap_get_trade_controls` tool — every control gate for a pool in one call (backed by `getTradeControls`). */
export const getTradeControlsSchema: AgentToolSchema = {
  name: 'shield_swap_get_trade_controls',
  description:
    'Check every control gate for a pool in one call — global/token/pair pauses, the ' +
    'enabled flag, allowlist state — plus a combined tradeable verdict. Advisory: state ' +
    'can change before finalization.',
  inputSchema: { type: 'object', properties: poolKeyProp, required: ['poolKey'] },
}

/** Declares the `shield_swap_get_frozen_position` tool — a chain-direct position-freeze check (backed by `getFrozenPosition`). */
export const getFrozenPositionSchema: AgentToolSchema = {
  name: 'shield_swap_get_frozen_position',
  description:
    'Check whether a position is frozen (blocks increase/decrease liquidity, collect, and ' +
    'burn). Returns the freeze block height, or null when not frozen.',
  inputSchema: {
    type: 'object',
    properties: {
      positionTokenId: { type: 'string', description: 'Position token id field literal.' },
    },
    required: ['positionTokenId'],
  },
}

/** Declares the `shield_swap_get_token_decimals` tool — a chain-direct token-registration read (backed by `getTokenDecimals`). */
export const getTokenDecimalsSchema: AgentToolSchema = {
  name: 'shield_swap_get_token_decimals',
  description:
    "Read a token's registered decimal count — feeds the no-dust rule for raw amounts. " +
    'Returns null for an unregistered token (create_pool would fail on it).',
  inputSchema: {
    type: 'object',
    properties: { tokenId: { type: 'string', description: 'Token id (field literal).' } },
    required: ['tokenId'],
  },
}

/** Declares the `shield_swap_is_pool_creation_open` tool — a chain-direct permissionless-creation check (backed by `isPoolCreationOpen`). */
export const isPoolCreationOpenSchema: AgentToolSchema = {
  name: 'shield_swap_is_pool_creation_open',
  description:
    'Check whether permissionless pool creation is open (when false, only the admin can ' +
    'create pools). Returns a boolean.',
  inputSchema: { type: 'object', properties: {}, required: [] },
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

/** Declares the `shield_swap_swap_multi_hop` write tool — phase one of a private 2–3 hop route swap; returns the handle `shield_swap_claim_multi_hop` consumes (backed by `swapMultiHop`). */
export const swapMultiHopSchema: AgentToolSchema = {
  name: 'shield_swap_swap_multi_hop',
  description:
    'Request a private multi-hop swap across 2–3 pools (phase one). Returns a handle to ' +
    'pass to shield_swap_claim_multi_hop once the request finalizes. Get the route and ' +
    'quoted output from shield_swap_get_route; a single-hop trade uses shield_swap_swap.',
  inputSchema: {
    type: 'object',
    properties: {
      poolKeys: {
        type: 'array',
        items: { type: 'string' },
        description: 'The 2–3 pool keys (field literals) in route order.',
      },
      tokenInId: { type: 'string', description: 'Token id being sold (field literal); must be in the first pool.' },
      amountIn: { type: 'string', description: 'Amount to sell, raw base units (u128) as a string.' },
      tokenPrograms: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Wrapper programs of every token on the route, the input token's program FIRST " +
          '(it holds the records being sold), then intermediates and output.',
      },
      expectedOut: { type: 'string', description: 'Quoted final output (u128 string) for slippage. Optional.' },
      slippageBps: { type: 'number', description: 'Slippage tolerance in basis points. Defaults to 50 (0.5%).' },
    },
    required: ['poolKeys', 'tokenInId', 'amountIn', 'tokenPrograms'],
  },
}

/** Declares the `shield_swap_claim_multi_hop` write tool — phase two of a private multi-hop swap; collects the output and refunds as private records (backed by `claimMultiHopOutput`). */
export const claimMultiHopSchema: AgentToolSchema = {
  name: 'shield_swap_claim_multi_hop',
  description:
    'Claim a finalized private multi-hop swap (phase two), collecting the output and any ' +
    'per-hop refunds as private records. Retry if it reports the output is not finalized yet.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: { type: 'object', description: 'The handle returned by shield_swap_swap_multi_hop.' },
      tokenPrograms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Wrapper programs of every token on the route (the claim can transfer up to four).',
      },
    },
    required: ['handle', 'tokenPrograms'],
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

// ---------------------------------------------------------------------------
// Pure derivation tools — no client, no API, no network. They load the
// optional @provablehq/sdk WASM peer for the BHP256 struct hash.
// ---------------------------------------------------------------------------

/** Declares the `shield_swap_derive_pool_key` tool — computes a pool key locally (backed by `derivePoolKey`). */
export const derivePoolKeySchema: AgentToolSchema = {
  name: 'shield_swap_derive_pool_key',
  description:
    'Compute a pool key locally from a token pair and fee tier — the key every pool read ' +
    'and swap uses. Order-independent in the tokens. No network.',
  inputSchema: {
    type: 'object',
    properties: {
      token0: { type: 'string', description: 'One token id (field literal). Order does not matter.' },
      token1: { type: 'string', description: 'The other token id (field literal).' },
      fee: { type: 'number', description: 'Fee tier in pips (u16), e.g. 3000 = 0.30%.' },
    },
    required: ['token0', 'token1', 'fee'],
  },
}

/** Declares the `shield_swap_derive_tick_key` tool — computes a `ticks` mapping key locally (backed by `deriveTickKey`). */
export const deriveTickKeySchema: AgentToolSchema = {
  name: 'shield_swap_derive_tick_key',
  description: "Compute a tick's `ticks` mapping key locally from a pool key and tick index. No network.",
  inputSchema: {
    type: 'object',
    properties: {
      ...poolKeyProp,
      tick: { type: 'number', description: 'Tick index (i32).' },
    },
    required: ['poolKey', 'tick'],
  },
}

/** Declares the `shield_swap_derive_swap_id` tool — computes a single-hop swap id locally (backed by `deriveSwapId`). */
export const deriveSwapIdSchema: AgentToolSchema = {
  name: 'shield_swap_derive_swap_id',
  description:
    'Compute a single-hop swap id locally from its preimage — pool, direction, amount, ' +
    'price bound, blinded address, nonce. No network; the id keys shield_swap_get_swap_output.',
  inputSchema: {
    type: 'object',
    properties: {
      ...poolKeyProp,
      zeroForOne: { type: 'boolean', description: "True when selling the pool's token0 for token1." },
      amountIn: { type: 'string', description: 'Amount sold, raw base units (u128) as a string.' },
      sqrtPriceLimit: { type: 'string', description: 'Submitted Q64 price bound (u128) as a string.' },
      blindedAddress: { type: 'string', description: "The swap's single-use blinded address (aleo1…)." },
      nonce: { type: 'string', description: 'The submitted u64 nonce as a string.' },
    },
    required: ['poolKey', 'zeroForOne', 'amountIn', 'sqrtPriceLimit', 'blindedAddress', 'nonce'],
  },
}

/** Declares the `shield_swap_derive_position_token_id` tool — computes a position token id locally (backed by `derivePositionTokenId`). */
export const derivePositionTokenIdSchema: AgentToolSchema = {
  name: 'shield_swap_derive_position_token_id',
  description:
    'Compute a position token id locally from the mint preimage — the request fields, ' +
    'recipient, and nonce. No network; the id keys shield_swap_get_position.',
  inputSchema: {
    type: 'object',
    properties: {
      poolKey: { type: 'string', description: 'Pool key field literal in the mint request.' },
      tickLower: { type: 'number', description: 'Lower tick as submitted (already spacing-aligned).' },
      tickUpper: { type: 'number', description: 'Upper tick as submitted.' },
      amount0Desired: { type: 'string', description: 'Submitted token0 amount, raw u128 string.' },
      amount1Desired: { type: 'string', description: 'Submitted token1 amount, raw u128 string.' },
      amount0Min: { type: 'string', description: 'Submitted token0 minimum, raw u128 string. Defaults to 0.' },
      amount1Min: { type: 'string', description: 'Submitted token1 minimum, raw u128 string. Defaults to 0.' },
      tickLowerHint: { type: 'number', description: 'Submitted lower insert hint.' },
      tickUpperHint: { type: 'number', description: 'Submitted upper insert hint.' },
      recipient: { type: 'string', description: 'The position owner address as submitted.' },
      nonce: { type: 'string', description: 'The mint nonce field literal as submitted.' },
    },
    required: [
      'poolKey', 'tickLower', 'tickUpper', 'amount0Desired', 'amount1Desired',
      'tickLowerHint', 'tickUpperHint', 'recipient', 'nonce',
    ],
  },
}

/** Declares the `shield_swap_derive_multi_hop_swap_id` tool — computes a multi-hop swap id locally (backed by `deriveMultiHopSwapId`). */
export const deriveMultiHopSwapIdSchema: AgentToolSchema = {
  name: 'shield_swap_derive_multi_hop_swap_id',
  description:
    'Compute a multi-hop swap id locally from its preimage — tokens, amounts, blinded ' +
    'address, the 2–3 hops, nonce, and deadline (the multi-hop preimage includes the ' +
    'deadline, unlike single-hop). No network.',
  inputSchema: {
    type: 'object',
    properties: {
      tokenInId: { type: 'string', description: 'Token id sold into the route (field literal).' },
      tokenOutId: { type: 'string', description: 'Token id the route pays out (field literal).' },
      amountIn: { type: 'string', description: 'Amount sold, raw base units (u128) as a string.' },
      amountOutMin: { type: 'string', description: 'Submitted minimum final output (u128) as a string.' },
      blindedAddress: { type: 'string', description: "The swap's single-use blinded address (aleo1…)." },
      hops: {
        type: 'array',
        description: 'The 2–3 submitted hops, in route order.',
        items: {
          type: 'object',
          properties: {
            poolKey: { type: 'string', description: 'Hop pool key field literal.' },
            zeroForOne: { type: 'boolean', description: 'Hop direction.' },
            sqrtPriceLimit: { type: 'string', description: 'Hop Q64 price bound (u128) as a string.' },
          },
          required: ['poolKey', 'zeroForOne', 'sqrtPriceLimit'],
        },
      },
      nonce: { type: 'string', description: 'The submitted u64 nonce as a string.' },
      deadline: { type: 'number', description: 'The submitted deadline block height (u32).' },
    },
    required: ['tokenInId', 'tokenOutId', 'amountIn', 'amountOutMin', 'blindedAddress', 'hops', 'nonce', 'deadline'],
  },
}

/** Chain-direct + private-balance tools — require a client. */
export const chainToolSchemas: AgentToolSchema[] = [
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
]

/** Pure derivation tools — no client or API backing; always available. */
export const pureToolSchemas: AgentToolSchema[] = [
  derivePoolKeySchema,
  deriveTickKeySchema,
  deriveSwapIdSchema,
  derivePositionTokenIdSchema,
  deriveMultiHopSwapIdSchema,
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
  swapMultiHopSchema,
  claimMultiHopSchema,
  mintSchema,
  increaseLiquiditySchema,
  decreaseLiquiditySchema,
  collectSchema,
  burnSchema,
]
