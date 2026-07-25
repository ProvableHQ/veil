// Shared wrapped-token dispatch for the liquidity write actions.
//
// mint, increaseLiquidity, and collect route by the (token0, token1)
// wrapped-ness pair: both plain goes straight to the core, any wrapped side
// goes through shield_swap_lp_router.aleo. The record slot for a wrapped
// side takes the caller's UNDERLYING record, immediately followed by that
// wrapper's freezelist sender proof. This module centralizes the dispatch
// table, record-program defaulting, and proof assembly so the three actions
// stay positional-input-exact without repeating the table.

import type { Client, TransactionInput } from '@provablehq/veil-core'
import { resolveTokenRoute, tokenIdToProgram, type TokenRoute } from '../../utils/routing.js'
import {
  formatMerkleProofPair,
  resolveProofPair,
  type ProofProvider,
} from '../../utils/proofs.js'
import { selectTokenRecord } from '../../utils/records.js'
import { ROUTER_ADDRESSES, SHIELD_SWAP_FREEZELIST, SHIELD_SWAP_LP_ROUTER } from '../../constants.js'

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
  if (value === ROUTER_ADDRESSES.router || value === ROUTER_ADDRESSES.lpRouter) {
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
 * Resolves and formats a wrapped side's freezelist sender proof.
 *
 * Returns the `[MerkleProof; 2]` literal that must immediately follow the
 * side's underlying record in a router call, or `undefined` for a plain
 * side (no proof slot exists). Pure unless a provider is configured.
 *
 * @param provider The configured proof provider, or undefined while
 *   freezelists are empty.
 * @param route The side's resolved route.
 * @param subject The address whose non-inclusion is proved (the sender).
 */
export async function wrapperSenderProof(
  provider: ProofProvider | undefined,
  route: TokenRoute,
  subject: string,
): Promise<string | undefined> {
  if (!route.wrapped) return undefined
  const pair = await resolveProofPair(provider, { list: 'wrapper', program: route.wrapperProgram, subject })
  return formatMerkleProofPair(pair)
}

/**
 * Resolves and formats one AMM-freezelist proof pair for a subject.
 *
 * Applies to `mint`'s signer/recipient/withdrawal proofs and `collect`'s
 * owner/withdrawal proofs, all proved against the AMM's own freezelist.
 * Pure unless a provider is configured.
 *
 * @param provider The configured proof provider, or undefined while
 *   freezelists are empty.
 * @param subject The address whose non-inclusion is proved.
 * @returns The `[MerkleProof; 2]` literal.
 */
export async function ammProofPair(provider: ProofProvider | undefined, subject: string): Promise<string> {
  const pair = await resolveProofPair(provider, { list: 'amm', program: SHIELD_SWAP_FREEZELIST, subject })
  return formatMerkleProofPair(pair)
}

/**
 * A resolved liquidity dispatch: which program and transition to call, the
 * record slots (with wrapper sender proofs interleaved), and where the
 * public `token_id` output sits in the transition's output list.
 *
 * @property program The program to execute (`shield_swap.aleo` or the LP
 *   router).
 * @property functionName The exact transition name.
 * @property recordInputs The record slots in positional order — each
 *   wrapped side's record is immediately followed by its sender proof.
 * @property tokenIdIndex Index of the public `token_id` in the outputs
 *   (0 direct, 1 one wrapped side, 2 both wrapped) — each wrapped side
 *   prepends an underlying change record.
 */
export interface LiquidityDispatch {
  program: string
  functionName: string
  recordInputs: TransactionInput[]
  tokenIdIndex: number
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
 * @returns The dispatch with positional record inputs and the token-id
 *   output index.
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
  senderProof0?: string
  senderProof1?: string
}): LiquidityDispatch {
  const { route0, route1, record0, record1, senderProof0, senderProof1 } = params
  if (route0.wrapped && !senderProof0) throw new Error('Missing sender proof for wrapped token0')
  if (route1.wrapped && !senderProof1) throw new Error('Missing sender proof for wrapped token1')

  if (!route0.wrapped && !route1.wrapped) {
    return {
      program: params.coreProgram,
      functionName: params.coreFunction,
      recordInputs: [record0, record1],
      tokenIdIndex: 0,
    }
  }
  if (route0.wrapped && !route1.wrapped) {
    return {
      program: SHIELD_SWAP_LP_ROUTER,
      functionName: `${params.routerPrefix}_wrapped_arc20`,
      recordInputs: [record0, senderProof0!, record1],
      tokenIdIndex: 1,
    }
  }
  if (!route0.wrapped && route1.wrapped) {
    return {
      program: SHIELD_SWAP_LP_ROUTER,
      functionName: `${params.routerPrefix}_arc20_wrapped`,
      recordInputs: [record0, record1, senderProof1!],
      tokenIdIndex: 1,
    }
  }
  return {
    program: SHIELD_SWAP_LP_ROUTER,
    functionName: `${params.routerPrefix}_wrapped_wrapped`,
    recordInputs: [record0, senderProof0!, record1, senderProof1!],
    tokenIdIndex: 2,
  }
}
