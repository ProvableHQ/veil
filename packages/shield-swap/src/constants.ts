import { PROGRAM_ID } from './generated/shield_swap_v3.js'

/** The shield_swap deployment — the default every DEX action targets. */
export const SHIELD_SWAP_V3 = 'shield_swap_v3.aleo'

// ── The shield_swap.aleo stack (successor deployment) ─────────────────

/** The core AMM of the current stack. */
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
 * The three shield wrapper programs and their underlying assets. Wrapped-ness
 * of arbitrary tokens is decided on-chain via the `from_wrapper_token_id`
 * mapping — this table only names the known deployments (record selection
 * needs the underlying program id before any network round-trip).
 */
export const SHIELD_WRAPPERS = {
  'shield_swap_arc20_credits.aleo': { underlying: 'credits.aleo', symbol: 'ALEO' },
  'shield_swap_arc20_wrapped_usdcx.aleo': { underlying: 'test_usdcx_stablecoin.aleo', symbol: 'USDCx' },
  'shield_swap_arc20_wrapped_usad.aleo': { underlying: 'test_usad_stablecoin.aleo', symbol: 'USAD' },
} as const

/**
 * The program every DEX action targets unless overridden.
 *
 * Follows the generated bindings' `PROGRAM_ID` — a single source of truth
 * codegen stamps from the ABI. It points at `shield_swap_v3.aleo`. Override per
 * client (`shieldSwapActions({ program })`) or per call (`program`); to move the
 * default, regenerate from a different program's ABI.
 */
export const DEFAULT_PROGRAM: string = PROGRAM_ID
