import { PROGRAM_ID } from './generated/shield_swap.js'

// ── The shield_swap.aleo stack ────────────────────────────────────────

/** The core AMM every DEX action targets by default. */
export const SHIELD_SWAP = 'shield_swap.aleo'
/** Swap and claim router — required entry for wrapped-input swaps and wrapped claims. */
export const SHIELD_SWAP_ROUTER = 'shield_swap_router.aleo'
/** LP router — required entry for mint/increase/collect touching a wrapped pool side. */
export const SHIELD_SWAP_LP_ROUTER = 'shield_swap_lp_router.aleo'
/** AMM compliance freezelist. */
export const SHIELD_SWAP_FREEZELIST = 'shield_swap_freezelist.aleo'
/** Admin multisig gating program upgrades. */
export const SHIELD_SWAP_MULTISIG = 'shield_swap_multisig_core.aleo'

/**
 * Program addresses hardcoded in the deployed core's bytecode. The core
 * enforces at finalize time that wrapped-token operations arrive from these
 * callers.
 *
 * @property router `shield_swap_router.aleo`'s program account.
 * @property lpRouter `shield_swap_lp_router.aleo`'s program account.
 */
export const ROUTER_ADDRESSES = {
  router: 'aleo1waeghjttfvzrmk68ckpp4ftnfh7aq6wcm73qxzy0m754x4cu6yxqf38zsq',
  lpRouter: 'aleo18sekmsl46y6skh3kvkekmw4kqqm7d6rz79akpsg58r7wpp5klyyq0qtzqf',
} as const

/**
 * The three shield wrapper programs and the assets they wrap, per network.
 *
 * The wrapper program ids are identical on both networks; their underlying
 * assets are not — mainnet drops the `test_` prefix, so
 * `shield_swap_arc20_wrapped_usdcx.aleo` wraps `test_usdcx_stablecoin.aleo` on
 * testnet and `usdcx_stablecoin.aleo` on mainnet. Reading the wrong row selects
 * records from a program that does not exist on the active network.
 *
 * This table only names the known deployments. Wrapped-ness of an arbitrary
 * token is decided on chain through the `from_wrapper_token_id` mapping, which
 * `resolveTokenRoute` uses — prefer that for anything the table does not list.
 * The table exists because record selection needs the underlying program id
 * before any network round-trip.
 */
export const SHIELD_WRAPPERS_BY_NETWORK = {
  testnet: {
    'shield_swap_arc20_credits.aleo': { underlying: 'credits.aleo', symbol: 'ALEO' },
    'shield_swap_arc20_wrapped_usdcx.aleo': { underlying: 'test_usdcx_stablecoin.aleo', symbol: 'USDCx' },
    'shield_swap_arc20_wrapped_usad.aleo': { underlying: 'test_usad_stablecoin.aleo', symbol: 'USAD' },
  },
  mainnet: {
    'shield_swap_arc20_credits.aleo': { underlying: 'credits.aleo', symbol: 'ALEO' },
    'shield_swap_arc20_wrapped_usdcx.aleo': { underlying: 'usdcx_stablecoin.aleo', symbol: 'USDCx' },
    'shield_swap_arc20_wrapped_usad.aleo': { underlying: 'usad_stablecoin.aleo', symbol: 'USAD' },
  },
} as const

/**
 * The wrapper table for a network.
 *
 * @param network Network the client reads, from `client.transport.config.network`.
 * @returns Wrapper program id to its underlying asset and display symbol.
 *
 * @example
 * const wrappers = shieldWrappersFor(client.transport.config.network)
 * const underlying = wrappers['shield_swap_arc20_wrapped_usdcx.aleo']?.underlying
 */
export function shieldWrappersFor(
  network: string,
): Record<string, { underlying: string; symbol: string }> {
  return network === 'mainnet' ? SHIELD_WRAPPERS_BY_NETWORK.mainnet : SHIELD_WRAPPERS_BY_NETWORK.testnet
}

/**
 * The testnet wrapper table.
 *
 * @deprecated Network-blind, so it names testnet's `test_`-prefixed underlyings
 *   on mainnet too. Use {@link shieldWrappersFor} with the client's network, or
 *   {@link SHIELD_WRAPPERS_BY_NETWORK} directly. Removed in the next major.
 */
export const SHIELD_WRAPPERS = SHIELD_WRAPPERS_BY_NETWORK.testnet

/**
 * The program every DEX action targets unless overridden.
 *
 * Follows the generated bindings' `PROGRAM_ID` — a single source of truth
 * codegen stamps from the ABI. It points at `shield_swap.aleo`. Override per
 * client (`shieldSwapActions({ program })`) or per call (`program`); to move the
 * default, regenerate from a different program's ABI.
 */
export const DEFAULT_PROGRAM: string = PROGRAM_ID
