import { PROGRAM_ID } from './generated/shield_swap.js'

/** The shield_swap deployment — the default every DEX action targets. */
export const SHIELD_SWAP_V3 = 'shield_swap_v3.aleo'

/**
 * The program every DEX action targets unless overridden.
 *
 * Follows the generated bindings' `PROGRAM_ID` — a single source of truth
 * codegen stamps from the ABI. It points at `shield_swap_v3.aleo`. Override per
 * client (`shieldSwapActions({ program })`) or per call (`program`); to move the
 * default, regenerate from a different program's ABI.
 */
export const DEFAULT_PROGRAM: string = PROGRAM_ID
