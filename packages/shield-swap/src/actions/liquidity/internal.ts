// Shared wrapped-token dispatch for the liquidity write actions.
//
// mint, increaseLiquidity, and collect route by the (token0, token1)
// wrapped-ness pair: both plain goes straight to the core, any wrapped side
// goes through shield_swap_lp_router.aleo. The record slot for a wrapped
// side takes the caller's UNDERLYING record, immediately followed by that
// wrapper's freezelist sender proof. This module centralizes the dispatch
// table, record-program defaulting, and proof assembly so the three actions
// stay positional-input-exact without repeating the table.

import { parseRecord, type Client, type TransactionInput, type FreezelistProofInput } from '@provablehq/veil-core'
import type { ComplianceProofs } from '../../utils/proofs.js'
import { resolveTokenRoute, tokenIdToProgram, type TokenRoute } from '../../utils/routing.js'
import { selectTokenRecord } from '../../utils/records.js'
import { ROUTER_ADDRESSES, SHIELD_SWAP_LP_ROUTER } from '../../constants.js'
import type { RebalanceAmountParameters } from './planRebalance.js'

type RebalanceHelperInput = RebalanceAmountParameters & {
  liquidityTarget?: bigint; maxFunding0?: bigint; maxFunding1?: bigint; required0?: bigint; required1?: bigint
}

/**
 * Preserves exact quote semantics for the exact-amount helper.
 * @param params Caller constraints, optionally including a complete plan.
 * @returns The unchanged constraints after validation.
 * @throws When a zero target or unequal token bounds would enable flexible recovery.
 * @example
 * exactRebalanceParameters({ liquidityTarget: 100n })
 */
export function exactRebalanceParameters<T extends RebalanceHelperInput>(params: T): T {
  validateRebalanceAmounts(params)
  if (params.liquidityTarget !== undefined && params.liquidityTarget <= 0n) {
    throw new Error('Exact amounts require a positive liquidityTarget')
  }
  if ((params.amount0Min !== undefined && params.amount0Min !== (params.amount0Desired ?? params.required0)) ||
      (params.amount1Min !== undefined && params.amount1Min !== (params.amount1Desired ?? params.required1))) {
    throw new Error('Exact amounts require minimum and desired amounts to be equal')
  }
  return params
}

/**
 * Defaults flexible token minimums to zero and requires explicit caps.
 * @param params Fixed transfers and token bounds.
 * @returns Constraints with both minimums and desired amounts specified.
 * @throws When caps are absent or quote-time funding budgets are supplied.
 * @example
 * boundedRebalanceParameters({ amount0Desired: 100n, amount1Desired: 100n })
 */
export function boundedRebalanceParameters<T extends RebalanceHelperInput>(params: T) {
  if (params.maxFunding0 !== undefined || params.maxFunding1 !== undefined) {
    throw new Error('Use fixed funding (funded0/funded1), not maxFunding, with explicit token bounds')
  }
  if (params.amount0Desired === undefined || params.amount1Desired === undefined) {
    throw new Error('Supply amount0Desired and amount1Desired for bounded rebalancing')
  }
  const result = { ...params, amount0Desired: params.amount0Desired, amount1Desired: params.amount1Desired,
    amount0Min: params.amount0Min ?? 0n, amount1Min: params.amount1Min ?? 0n }
  validateRebalanceAmounts(result)
  return result
}

/**
 * Requires exact successor liquidity with flexible recovery.
 * @param params Positive target, token caps, and optional token minimums.
 * @returns Constraints with zero minimums where omitted.
 * @throws When the target is not positive or both bounds are exact.
 * @example
 * liquidityRebalanceParameters({ liquidityTarget: 100n, amount0Desired: 10n, amount1Desired: 10n })
 */
export function liquidityRebalanceParameters<T extends RebalanceHelperInput>(params: T) {
  if (params.liquidityTarget === undefined || params.liquidityTarget <= 0n) {
    throw new Error('Exact liquidity requires a positive liquidityTarget')
  }
  const result = boundedRebalanceParameters(params)
  if (result.amount0Min === result.amount0Desired && result.amount1Min === result.amount1Desired) {
    throw new Error('Flexible recovery requires a wider bound on at least one token; use rebalancePositionExactAmounts for exact bounds')
  }
  return { ...result, liquidityTarget: params.liquidityTarget }
}

/**
 * Selects execution-time liquidity sizing without accepting a fixed target.
 * @param params Token caps, minimums, and fixed transfers.
 * @returns Constraints with a zero liquidity target.
 * @throws When a positive target or quote-time funding budget is supplied.
 * @example
 * amountRebalanceParameters({ amount0Desired: 100n, amount1Desired: 100n })
 */
export function amountRebalanceParameters<T extends RebalanceHelperInput>(params: T) {
  if (params.liquidityTarget !== undefined && params.liquidityTarget !== 0n) {
    throw new Error('Amount-driven rebalancing requires a zero liquidityTarget')
  }
  return { ...boundedRebalanceParameters({ ...params, liquidityTarget: 0n }), liquidityTarget: 0n as const }
}

/**
 * Validates rebalance bounds and accounting without contacting a network.
 *
 * @param params Token constraints and optional complete quote accounting.
 * @throws When values exceed u128, bounds conflict, transfers conflict, or exact accounting does not balance.
 * @example
 * validateRebalanceAmounts({ liquidityTarget: 0n, amount0Desired: 100n, amount1Desired: 100n })
 */
export function validateRebalanceAmounts(params: RebalanceAmountParameters & {
  liquidityTarget?: bigint; oldLiquidity?: bigint; recovered0?: bigint; recovered1?: bigint
  required0?: bigint; required1?: bigint; maxFunding0?: bigint; maxFunding1?: bigint
}): void {
  if (params.liquidityTarget !== undefined && (params.maxFunding0 !== undefined || params.maxFunding1 !== undefined)) {
    throw new Error('Pass exactly one sizing mode: liquidityTarget, or maxFunding0 and maxFunding1 together')
  }
  const fields = ['liquidityTarget', 'oldLiquidity', 'recovered0', 'recovered1', 'required0', 'required1',
    'maxFunding0', 'maxFunding1', 'amount0Desired', 'amount1Desired', 'amount0Min', 'amount1Min',
    'funded0', 'funded1', 'refund0', 'refund1'] as const
  for (const key of fields) {
    const value = params[key]
    if (value !== undefined && (typeof value !== 'bigint' || value < 0n || value >= 1n << 128n)) {
      throw new Error(`${key} must be a u128 bigint`)
    }
  }
  if ((params.amount0Desired === undefined) !== (params.amount1Desired === undefined)) {
    throw new Error('Supply amount0Desired and amount1Desired together')
  }
  if ((params.amount0Min !== undefined || params.amount1Min !== undefined) && params.amount0Desired === undefined) {
    throw new Error('Token minimums require amount0Desired and amount1Desired')
  }
  const desired = [params.amount0Desired ?? params.required0, params.amount1Desired ?? params.required1]
  const minimum = [params.amount0Min ?? desired[0], params.amount1Min ?? desired[1]]
  const flexible = params.liquidityTarget === 0n || minimum.some((min, i) => min !== undefined && desired[i] !== undefined && min < desired[i]!)
  for (const [i, cap] of desired.entries()) {
    if (cap !== undefined && minimum[i]! > cap) throw new Error(`Token${i} minimum exceeds its desired amount`)
    const funded = i === 0 ? params.funded0 : params.funded1
    const refund = i === 0 ? params.refund0 : params.refund1
    if ((funded ?? 0n) > 0n && (refund ?? 0n) > 0n) throw new Error(`Token${i} cannot have both funding and a refund`)
    const recovered = i === 0 ? params.recovered0 : params.recovered1
    const required = i === 0 ? params.required0 : params.required1
    if (!flexible && cap !== undefined && required !== undefined && cap !== required) {
      throw new Error(`Exact token${i} amount must match the liquidity target's quoted deposit`)
    }
    if (!flexible && cap !== undefined && recovered !== undefined && funded !== undefined && refund !== undefined && recovered + funded !== cap + refund) {
      throw new Error(`Exact token${i} recovery and funding must equal its desired amount and refund`)
    }
  }
}

/** The Aleo zero address — the burn sink no payout slot may name. */
const ZERO_ADDRESS = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'

/**
 * Validates a payout address input (`recipient`, `withdrawal`).
 *
 * Rejects the zero address and the stack's known program accounts (the
 * routers) — tokens paid to either are unrecoverable. Pure and local.
 *
 * @param name Parameter name for the error message.
 * @param value The address to validate.
 * @throws When the address is missing, the zero address, or a router
 *   program account.
 */
export function assertPayoutAddress(name: string, value: string | undefined): asserts value is string {
  if (!value) throw new Error(`${name} is required — pass the address explicitly`)
  if (value === ZERO_ADDRESS) throw new Error(`${name} must not be the zero address`)
  if (
    value === ROUTER_ADDRESSES.router ||
    value === ROUTER_ADDRESSES.lpRouter ||
    value === ROUTER_ADDRESSES.rebalanceRouter
  ) {
    throw new Error(`${name} must not be a program account of the shield_swap stack`)
  }
}

/**
 * Resolves both pool sides' token routes concurrently.
 *
 * Hits the network on the first resolution of each token (cached
 * afterwards) unless overrides are supplied.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The two token ids, the core program carrying the wrapper
 *   mappings, and optional pre-resolved route overrides.
 * @returns The token0 and token1 routes.
 */
export async function resolveSideRoutes(
  client: Client,
  params: {
    token0Id: string
    token1Id: string
    program: string
    token0Route?: TokenRoute
    token1Route?: TokenRoute
  },
): Promise<[TokenRoute, TokenRoute]> {
  return Promise.all([
    resolveTokenRoute(client, { tokenId: params.token0Id, program: params.program, route: params.token0Route }),
    resolveTokenRoute(client, { tokenId: params.token1Id, program: params.program, route: params.token1Route }),
  ])
}

/**
 * The program a pool side's spendable records live in.
 *
 * A wrapped side spends the UNDERLYING asset's records (credits for wALEO,
 * the stablecoin program for USDCx/USAD); a plain side spends the token's
 * own ARC-20 records, whose program is decoded from the token id. Pure and
 * local.
 *
 * @param route The side's resolved route.
 * @param override Caller-supplied program override; wins when set.
 * @returns The program id to scan for records.
 * @throws When a plain token id does not decode to a program name and no
 *   override is given.
 */
export function recordProgramFor(route: TokenRoute, override?: string): string {
  if (override) return override
  if (route.wrapped) return route.underlyingProgram
  const program = tokenIdToProgram(route.tokenId)
  if (!program) {
    throw new Error(
      `Token ${route.tokenId} does not decode to a program name — pass the record program explicitly`,
    )
  }
  return program
}

/**
 * Auto-selects a pool side's record on the local-signer path.
 *
 * Selects from the side's record program ({@link recordProgramFor}): a plain
 * side filters by its token id, a wrapped side selects the underlying
 * program's records (which carry no AMM token id). Hits the network: one
 * record scan.
 *
 * @param client A Veil wallet client with a record provider.
 * @param route The side's resolved route.
 * @param minAmount Smallest acceptable record amount (u128).
 * @param programOverride Caller-supplied record program; wins when set.
 * @returns The selected record's plaintext literal.
 * @throws When no unspent record covers the amount.
 */
export async function autoSelectSideRecord(
  client: Client,
  route: TokenRoute,
  minAmount: bigint,
  programOverride?: string,
): Promise<string> {
  const picked = await selectTokenRecord(client, {
    program: recordProgramFor(route, programOverride),
    minAmount,
    tokenId: route.wrapped ? undefined : route.tokenId,
  })
  return picked.record.recordPlaintext
}

/**
 * A resolved liquidity dispatch: which program and transition to call and the
 * record slots (with wrapper sender proofs interleaved).
 *
 * @property program The program to execute (`shield_swap.aleo` or the LP
 *   router).
 * @property functionName The exact transition name.
 * @property recordInputs The record slots in positional order — each
 *   wrapped side's record is immediately followed by its sender proof.
 */
export interface LiquidityDispatch {
  program: string
  functionName: string
  recordInputs: TransactionInput[]
}

/**
 * Builds the dispatch for a two-record liquidity call (`mint`,
 * `increase_liquidity`) from the sides' wrapped-ness.
 *
 * Implements the guide's table: (plain, plain) calls the core directly;
 * (wrapped, plain) `<prefix>_wrapped_arc20`; (plain, wrapped)
 * `<prefix>_arc20_wrapped`; (wrapped, wrapped) `<prefix>_wrapped_wrapped` —
 * all on `shield_swap_lp_router.aleo`. Pure and local.
 *
 * @param params The core program/transition, the router transition prefix
 *   (`mint_from`, `increase_from`), both routes, both record inputs, and the
 *   wrapped sides' sender-proof literals.
 * @returns The dispatch with positional record inputs.
 * @throws When a wrapped side is missing its sender proof (an internal
 *   assembly error, not a caller mistake).
 */
export function dispatchLiquidityCall(params: {
  coreProgram: string
  coreFunction: 'mint' | 'increase_liquidity'
  routerPrefix: 'mint_from' | 'increase_from'
  route0: TokenRoute
  route1: TokenRoute
  record0: TransactionInput
  record1: TransactionInput
  senderProof0?: FreezelistProofInput
  senderProof1?: FreezelistProofInput
}): LiquidityDispatch {
  const { route0, route1, record0, record1, senderProof0, senderProof1 } = params
  if (route0.wrapped && !senderProof0) throw new Error('Missing sender proof for wrapped token0')
  if (route1.wrapped && !senderProof1) throw new Error('Missing sender proof for wrapped token1')

  if (!route0.wrapped && !route1.wrapped) {
    return {
      program: params.coreProgram,
      functionName: params.coreFunction,
      recordInputs: [record0, record1],
    }
  }
  if (route0.wrapped && !route1.wrapped) {
    return {
      program: SHIELD_SWAP_LP_ROUTER,
      functionName: `${params.routerPrefix}_wrapped_arc20`,
      recordInputs: [record0, senderProof0!, record1],
    }
  }
  if (!route0.wrapped && route1.wrapped) {
    return {
      program: SHIELD_SWAP_LP_ROUTER,
      functionName: `${params.routerPrefix}_arc20_wrapped`,
      recordInputs: [record0, record1, senderProof1!],
    }
  }
  return {
    program: SHIELD_SWAP_LP_ROUTER,
    functionName: `${params.routerPrefix}_wrapped_wrapped`,
    recordInputs: [record0, senderProof0!, record1, senderProof1!],
  }
}

/**
 * Resolves the position's withdrawal subject before requesting real proofs.
 *
 * Reads granted plaintext locally and verifies any explicit address against it.
 * Automatic generation and providers declaring requiresSubject need a known
 * address. Supplied proofs and other providers own their subject selection.
 *
 * @property positionInput Plaintext or wallet-selected position record.
 * @property withdrawalAddress Optional explicit proof subject; defaults to the
 *   plaintext withdrawal field.
 * @property proofs Optional supplied proofs or provider; omission enables automatic generation.
 * @property signerAddress Legacy provider fallback when the withdrawal subject is unknown.
 * @param params The record, explicit address, proof source, and signer fallback.
 * @returns The known or annotated withdrawal subject, or the legacy signer fallback for caller-owned proofs.
 * @throws When addresses conflict, supplied annotations are ambiguous, or proof construction needs an unavailable subject.
 *
 * @example
 * const subject = resolveWithdrawalSubject({
 *   positionInput: '{ ... }', withdrawalAddress: 'aleo1...', signerAddress: 'aleo1...',
 * })
 */
export function resolveWithdrawalSubject(params: {
  positionInput: TransactionInput
  withdrawalAddress?: string | undefined
  proofs?: ComplianceProofs<readonly string[]> | undefined
  signerAddress: string
}): string {
  let fromRecord: string | undefined
  if (typeof params.positionInput === 'string') {
    try {
      const value = parseRecord(params.positionInput).fields.withdrawal?.value
      if (typeof value === 'string' && value.startsWith('aleo1')) fromRecord = value
    } catch {
      // A record ciphertext or opaque literal cannot reveal the withdrawal subject.
    }
  }
  if (fromRecord && params.withdrawalAddress !== undefined && params.withdrawalAddress !== fromRecord) {
    throw new Error('withdrawalAddress must match the position record withdrawal address')
  }
  const subject = fromRecord ?? params.withdrawalAddress
  if (subject) return subject
  const { proofs, signerAddress } = params
  if (proofs == null || (typeof proofs === 'function' && proofs.requiresSubject)) {
    throw new Error('withdrawalAddress must be provided to construct compliance proofs when the position record is opaque')
  }
  // Annotated proofs name the payout subject themselves; literals need no lookup.
  if (Array.isArray(proofs)) {
    const addresses = new Set(proofs.flatMap(proof =>
      typeof proof === 'string' || proof.address === signerAddress ? [] : [proof.address],
    ))
    if (addresses.size > 1) {
      throw new Error('Supplied compliance proofs name multiple withdrawal addresses; supply an ABI-ordered proof tuple or a provider')
    }
    if (addresses.size === 1) return addresses.values().next().value!
  }
  // Preserve the context passed to custom providers before automatic generation.
  return signerAddress
}
