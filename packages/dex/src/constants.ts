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

/**
 * Domain separator for deriving a blinding factor from a view key and counter.
 *
 * Wallet-side only — the contract never sees the view key, so this value does
 * not appear in the deployed bytecode. Pinned from the Provable reference
 * client (`amm-v3-tests`), where it is documented as
 * `Identifier("amm_v3_blinding_factor")`.
 */
export const BLINDING_FACTOR_DOMAIN =
  '42815354924796718559205719970686750292466968495484257field'

/**
 * Domain separator for deriving a blinded address from a blinding factor.
 *
 * MUST match the constant the program hashes in `verify_blinded_address` —
 * verified against the deployed shield_swap_v0_0_2.aleo bytecode (the literal
 * appears in its Poseidon8 preimage cast). Documented in the reference client
 * as `Identifier("amm_v3_private_claim_or_swap")`.
 */
export const CLAIM_OR_SWAP_DOMAIN =
  '11835072102227764468342786961086432175093421716844963782363567713633field'

/**
 * Wallet-standard algorithm names for wallet-side derivation (see core's
 * `KNOWN_ALGORITHMS`). A dapp talking to a privacy-preserving wallet fills the
 * blinding-factor / blinded-address input slots with `derived` InputRequests
 * naming these algorithms instead of deriving locally.
 */
export const BLINDING_FACTOR_ALGORITHM = 'program-scoped-blinding-factor'
export const BLINDED_ADDRESS_ALGORITHM = 'program-scoped-blinded-address'
