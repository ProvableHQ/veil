import { PROGRAM_ID } from './generated/shield_swap.js'

/** The original shield_swap deployment — the live venue (pools, liquidity, indexer). */
export const SHIELD_SWAP_V0_0_1 = 'shield_swap_v0_0_1.aleo'

/** The newer shield_swap deployment — config-seeded, awaiting pools/indexer migration. */
export const SHIELD_SWAP_V0_0_2 = 'shield_swap_v0_0_2.aleo'

/**
 * The program every DEX action targets unless overridden.
 *
 * Follows the generated bindings' `PROGRAM_ID` — a single source of truth set
 * by codegen from `veil.config.json`'s `programId`. It points at the live
 * deployment (v0_0_1: pools, liquidity, indexer), while the bindings' *shape*
 * is generated from the v0_0_2 ABI (the only one current `leo abi` parses);
 * both deployments share entrypoints, struct layouts, and blinding domains,
 * and the decoders are exercised against live v0_0_1 data in integration
 * tests. Override per client (`dexActions({ program })`) or per call
 * (`program`); to move the default, change `programId` and regenerate.
 */
export const DEFAULT_PROGRAM: string = PROGRAM_ID
