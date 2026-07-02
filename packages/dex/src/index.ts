// Generated bindings: typed structs/records, decoders, and the contract factory
// for shield_swap. Regenerate with `pnpm generate` (ABI via `pnpm regen-abi`).
export * from './generated/shield_swap.js'

// Chain-direct reads (trust-critical: values come from the node, not an indexer).
export { getPool, type GetPoolParameters, type GetPoolReturnType } from './actions/reads/getPool.js'
export { getSlot, type GetSlotParameters, type GetSlotReturnType } from './actions/reads/getSlot.js'
export {
  getSwapOutput,
  type GetSwapOutputParameters,
  type GetSwapOutputReturnType,
} from './actions/reads/getSwapOutput.js'
export {
  isBlindedAddressUsed,
  isPoolInitialized,
  isFeeTierValid,
  isTickSpacingValid,
  getFeeToTickSpacing,
} from './actions/reads/validation.js'

// Blinded identity (private-swap identity lifecycle). Local derivation lazily
// loads the optional @provablehq/sdk peer; wallet accounts never need it.
export {
  deriveBlindingFactor,
  deriveBlindedAddress,
  nextBlindedIdentity,
  type BlindedIdentity,
  type NextBlindedIdentityParameters,
} from './blinded-identity.js'
export {
  BLINDING_FACTOR_DOMAIN,
  CLAIM_OR_SWAP_DOMAIN,
  BLINDING_FACTOR_ALGORITHM,
  BLINDED_ADDRESS_ALGORITHM,
} from './constants.js'

// Record selection + record-derived balances (local-signer path; wallet
// signers select records wallet-side via record InputRequests).
export {
  parseTokenRecordInfo,
  selectTokenRecord,
  getOwnBalances,
  type TokenRecordInfo,
  type SelectTokenRecordParameters,
  type GetOwnBalancesParameters,
  type GetOwnBalancesReturnType,
} from './records.js'

// Swap parameter helpers: intent → contract args (pure), deadline, nonces,
// and the contract's Q64 tick math table.
export {
  resolveSwapParams,
  getDeadline,
  generateSwapNonce,
  generateFieldNonce,
  type ResolveSwapParamsInput,
  type ResolvedSwapParams,
} from './helpers/params.js'
export {
  Q64,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
  getSqrtPriceAtTick,
  roundTickToSpacing,
  dustScale,
} from './helpers/tick-math.js'
