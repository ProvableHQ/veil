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
