import { PROGRAM_ID } from './generated/shield_swap.js'

// ── The shield_swap.aleo stack ────────────────────────────────────────

/** The core AMM every DEX action targets by default. */
export const SHIELD_SWAP = 'shield_swap.aleo'
/** Swap and claim router — required entry for wrapped-input swaps and wrapped claims. */
export const SHIELD_SWAP_ROUTER = 'shield_swap_router.aleo'
/** LP router — required entry for mint/increase/collect touching a wrapped pool side. */
export const SHIELD_SWAP_LP_ROUTER = 'shield_swap_lp_router.aleo'
/** Rebalance router — the entry every position rebalance goes through. */
export const SHIELD_SWAP_REBALANCE_ROUTER = 'shield_swap_rebalance_router.aleo'
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
 * @property rebalanceRouter `shield_swap_rebalance_router.aleo`'s program account.
 */
export const ROUTER_ADDRESSES = {
  router: 'aleo1waeghjttfvzrmk68ckpp4ftnfh7aq6wcm73qxzy0m754x4cu6yxqf38zsq',
  lpRouter: 'aleo18sekmsl46y6skh3kvkekmw4kqqm7d6rz79akpsg58r7wpp5klyyq0qtzqf',
  rebalanceRouter: 'aleo1epmqawx42jtnxclqzsdva4pxgzvn2jevjk424sj6gwuq08m3yyqsmrdsda',
} as const

/**
 * The program every DEX action targets unless overridden.
 *
 * Follows the generated bindings' `PROGRAM_ID` — a single source of truth
 * codegen stamps from the ABI. It points at `shield_swap.aleo`. Override per
 * client (`shieldSwapActions({ program })`) or per call (`program`); to move the
 * default, regenerate from a different program's ABI.
 */
export const DEFAULT_PROGRAM: string = PROGRAM_ID
