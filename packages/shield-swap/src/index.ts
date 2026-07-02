// Generated bindings: typed structs/records, decoders, and the contract factory
// for shield_swap. Regenerate with `pnpm generate` (ABI via `pnpm regen-abi`).
export * from './generated/shield_swap.js'

// Chain-direct reads (trust-critical: values come from the node, not the API).
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
  viewKeyToScalar,
  BLINDING_FACTOR_DOMAIN,
  CLAIM_OR_SWAP_DOMAIN,
  type BlindedIdentity,
  type NextBlindedIdentityParameters,
} from './utils/blinding/identity.js'

// The two-phase private swap: request → (chain computes) → claim.
export {
  swapPrivate,
  type SwapHandle,
  type SwapPrivateParameters,
  type SwapPrivateReturnType,
} from './actions/swap/swapPrivate.js'
export {
  claimSwapOutputPrivate,
  SwapOutputNotFinalizedError,
  type ClaimSwapOutputPrivateParameters,
  type ClaimSwapOutputPrivateReturnType,
} from './actions/swap/claimSwapOutputPrivate.js'

// Off-chain DEX API client (trusted convenience layer; typed from the
// service's own OpenAPI via `pnpm regen-openapi`).
export {
  ApiClient,
  ApiError,
  DEFAULT_API_URL,
  type ApiClientOptions,
} from './api/client.js'

// Wallet-signer InputRequest builders + the connect-time algorithm grants.
export {
  SHIELD_SWAP_ALGORITHM_GRANTS,
  shieldSwapAlgorithmGrants,
  BLINDING_MEMBERSHIP_MAPPING,
  BLINDING_FACTOR_ALGORITHM,
  BLINDED_ADDRESS_ALGORITHM,
  blindingFactorIssueRequest,
  blindedAddressIssueRequest,
  blindingFactorResolveRequest,
  blindedAddressResolveRequest,
} from './utils/blinding/requests.js'
export { SHIELD_SWAP_V0_0_1, SHIELD_SWAP_V0_0_2, DEFAULT_PROGRAM } from './constants.js'

// Record selection + record-derived balances (local-signer path; wallet
// signers select records wallet-side via record InputRequests).
export {
  parseTokenRecordInfo,
  selectTokenRecord,
  selectPositionNFT,
  getPrivateBalances,
  type TokenRecordInfo,
  type PositionNFTInfo,
  type SelectTokenRecordParameters,
  type SelectPositionNFTParameters,
  type GetPrivateBalancesParameters,
  type GetPrivateBalancesReturnType,
} from './utils/records.js'

// Combined public + private + total balances (composes the API and records).
export {
  getBalances,
  type GetBalancesParameters,
  type GetBalancesReturnType,
  type BalanceEntry,
} from './utils/balances.js'

// Liquidity lifecycle: create a pool, mint a position, deepen it.
export { createPool, type CreatePoolParameters, type CreatePoolReturnType } from './actions/liquidity/createPool.js'
export {
  mintPrivate,
  formatMintPositionRequest,
  type MintPrivateParameters,
  type MintPrivateReturnType,
} from './actions/liquidity/mintPrivate.js'
export {
  increaseLiquidityPrivate,
  type IncreaseLiquidityPrivateParameters,
  type IncreaseLiquidityPrivateReturnType,
} from './actions/liquidity/increaseLiquidityPrivate.js'
export { pickInsertHint, type PickInsertHintParameters } from './utils/tick-hints.js'

// Pure strategy primitives (no I/O): prices, impact, valuation, fee APR.
export {
  poolPrice,
  priceImpact,
  portfolioValue,
  feeAprEstimate,
  type PoolPriceInput,
  type PriceImpactInput,
  type Holding,
  type FeeAprEstimateInput,
} from './utils/derivations.js'

// One-surface composition: chain reads flat, API under `.api`.
export { shieldSwapActions, type ShieldSwapActionsConfig, type ShieldSwapActions } from './decorators/shieldSwapActions.js'

// Swap parameter helpers: intent → contract args (pure), deadline, nonces,
// and the contract's Q64 tick math table.
export {
  resolveSwapParams,
  getDeadline,
  generateSwapNonce,
  generateFieldNonce,
  type ResolveSwapParamsInput,
  type ResolvedSwapParams,
} from './utils/params.js'
export {
  Q64,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
  getSqrtPriceAtTick,
  roundTickToSpacing,
  dustScale,
} from './utils/tick-math.js'
