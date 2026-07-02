import { PROGRAM_ID } from './generated/shield_swap.js'

/** The original shield_swap deployment — the live venue (pools, liquidity, API). */
export const SHIELD_SWAP_V0_0_1 = 'shield_swap_v0_0_1.aleo'

/** The newer shield_swap deployment — config-seeded, awaiting pools/API migration. */
export const SHIELD_SWAP_V0_0_2 = 'shield_swap_v0_0_2.aleo'

/**
 * The program every DEX action targets unless overridden.
 *
 * Follows the generated bindings' `PROGRAM_ID` — a single source of truth
 * codegen stamps from the ABI. It points at the live deployment (v0_0_1:
 * pools, liquidity, API). Override per client (`shieldSwapActions({ program })`)
 * or per call (`program`); to move the default, regenerate from a different
 * program's ABI.
 */
export const DEFAULT_PROGRAM: string = PROGRAM_ID
