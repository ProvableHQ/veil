import {
  executeContract,
  writeContract,
  parseRecord,
  type Client,
  type InputRequest,
  type TransactionInput,
} from '@provablehq/veil-core'
import { requireAccount, requirePool, requireSlot } from '../../utils/guards.js'
import { resolvePositionRecord } from '../../utils/records.js'
import {
  formatMintPositionRequest,
  formatRebalanceAssets,
  formatRebalanceRequest,
  generateFieldNonce,
  getDeadline,
} from '../../utils/params.js'
import { requireFieldOutput } from '../../utils/outputs.js'
import { roundTickToSpacing } from '../../utils/tick-math.js'
import { pickInsertHint, type PickInsertHintParameters } from '../../utils/tick-hints.js'
import { amountsForLiquidity, getSqrtPriceAtTickX128 } from '../../utils/q128.js'
import type { TokenRoute } from '../../utils/routing.js'
import type { ProofProvider } from '../../utils/proofs.js'
import { getPosition } from '../reads/getPosition.js'
import { SHIELD_SWAP, SHIELD_SWAP_REBALANCE_ROUTER } from '../../constants.js'
import {
  ammProofPair,
  autoSelectSideRecord,
  resolveSideRoutes,
  wrapperSenderProof,
} from './internal.js'

/**
 * Picks which of the router's 14 rebalance transitions to call.
 *
 * Leo transitions cannot take optional inputs, so the router deploys a
 * separate transition per input layout and names it after the layout: the
 * shape of token0 and token1 (`plain`, or `wrapped` — a pool token backed by
 * an underlying asset, which adds proof inputs), then the funded sides
 * (`none`, `fund0`, `fund1`, `both`). When both tokens have the same shape,
 * funding either side is the same layout, so a single `one` transition
 * replaces `fund0`/`fund1`. Pure and local.
 *
 * @param params Each side's wrapped-ness and whether it takes a funding record.
 * @returns The `rebalance_*` transition name.
 *
 * @example
 * selectRebalanceEntry({ wrapped0: true, wrapped1: false, funds0: true, funds1: false })
 * // 'rebalance_wrapped_plain_fund0'
 */
export function selectRebalanceEntry(params: {
  wrapped0: boolean
  wrapped1: boolean
  funds0: boolean
  funds1: boolean
}): string {
  const shape = `${params.wrapped0 ? 'wrapped' : 'plain'}_${params.wrapped1 ? 'wrapped' : 'plain'}`
  let mode = 'none'
  if (params.funds0 && params.funds1) {
    mode = 'both'
  } else if (params.funds0 || params.funds1) {
    mode = params.wrapped0 === params.wrapped1 ? 'one' : params.funds0 ? 'fund0' : 'fund1'
  }
  return `rebalance_${shape}_${mode}`
}

/**
 * Parameters for {@link previewRebalance}.
 *
 * @property poolKey Pool the position belongs to.
 * @property positionTokenId The position to rebalance, by `token_id`.
 * @property tickLower Lower bound of the successor range, before spacing
 *   alignment.
 * @property tickUpper Upper bound of the successor range.
 * @property liquidityTarget Exact liquidity of the successor position (u128).
 * @property token0Route Pre-resolved route override for token0 — skips the
 *   on-chain wrapped-ness read (offline/advanced use).
 * @property token1Route Pre-resolved route override for token1.
 * @property program shield_swap core program override. Defaults to
 *   `shield_swap.aleo`.
 */
export type PreviewRebalanceParameters = {
  poolKey: string
  positionTokenId: string
  tickLower: number
  tickUpper: number
  liquidityTarget: bigint
  token0Route?: TokenRoute
  token1Route?: TokenRoute
  program?: string
}

/**
 * The exact close-and-remint accounting a rebalance would submit.
 *
 * All amounts are raw base units (u128 on chain, `bigint` here). The
 * contract asserts these values exactly at finalize time, so a quote is
 * only submittable while the pool price and the position's owed balances
 * are unchanged — requote after any delay.
 *
 * @property tickLower The successor range's lower bound after spacing alignment.
 * @property tickUpper The successor range's upper bound after alignment.
 * @property oldLiquidity The position's live liquidity.
 * @property recovered0 Token0 recovered by closing the range: principal plus owed.
 * @property recovered1 Token1 recovered, principal plus owed.
 * @property required0 Token0 the successor range needs at the current price.
 * @property required1 Token1 the successor range needs.
 * @property funded0 Token0 the caller must supply (`max(required - recovered, 0)`).
 * @property funded1 Token1 the caller must supply.
 * @property refund0 Token0 surplus paid to the withdrawal address.
 * @property refund1 Token1 surplus paid back.
 * @property liquidityTarget The successor position's exact liquidity.
 * @property functionName The rebalance router entrypoint the quote selects.
 */
export type PreviewRebalanceReturnType = {
  tickLower: number
  tickUpper: number
  oldLiquidity: bigint
  recovered0: bigint
  recovered1: bigint
  required0: bigint
  required1: bigint
  funded0: bigint
  funded1: bigint
  refund0: bigint
  refund1: bigint
  liquidityTarget: bigint
  functionName: string
}

/**
 * Quotes a position rebalance against the pool's live state.
 *
 * Prices closing the position's current range (principal at the live sqrt
 * price plus the owed balances) against opening the successor range at
 * `liquidityTarget`, and derives the funding each side needs and the surplus
 * each side refunds. Hits the network: pool, slot, position, and route reads.
 * Reads only — no signing.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The position, the successor range, and the liquidity target.
 * @returns The exact accounting {@link rebalancePosition} submits.
 * @throws When the pool or position does not exist, or the aligned range is
 *   empty.
 *
 * @example
 * const quote = await previewRebalance(client, {
 *   poolKey, positionTokenId, tickLower: -1200, tickUpper: -600,
 *   liquidityTarget: 500_000n,
 * })
 */
export async function previewRebalance(
  client: Client,
  params: PreviewRebalanceParameters,
): Promise<PreviewRebalanceReturnType> {
  const program = params.program ?? SHIELD_SWAP
  const pool = await requirePool(client, params.poolKey, program)
  const slot = await requireSlot(client, params.poolKey, program)
  const position = await getPosition(client, { positionTokenId: params.positionTokenId, program })
  if (!position) throw new Error(`Position does not exist: ${params.positionTokenId}`)

  const tickLower = roundTickToSpacing(params.tickLower, slot.tick_spacing)
  const tickUpper = roundTickToSpacing(params.tickUpper, slot.tick_spacing)
  if (tickLower >= tickUpper) {
    throw new Error(`Empty tick range after spacing alignment: [${tickLower}, ${tickUpper})`)
  }

  const principal = amountsForLiquidity({
    sqrtPriceX128: slot.sqrt_price,
    sqrtLowerX128: getSqrtPriceAtTickX128(position.tick_lower),
    sqrtUpperX128: getSqrtPriceAtTickX128(position.tick_upper),
    liquidity: position.liquidity,
  })
  const recovered0 = principal.amount0 + position.tokens_owed0
  const recovered1 = principal.amount1 + position.tokens_owed1

  // The successor range rounds up: the contract takes at most these amounts,
  // and anything the recovered balances do not cover must arrive as funding.
  const required = amountsForLiquidity({
    sqrtPriceX128: slot.sqrt_price,
    sqrtLowerX128: getSqrtPriceAtTickX128(tickLower),
    sqrtUpperX128: getSqrtPriceAtTickX128(tickUpper),
    liquidity: params.liquidityTarget,
    roundUp: true,
  })
  const funded0 = required.amount0 > recovered0 ? required.amount0 - recovered0 : 0n
  const funded1 = required.amount1 > recovered1 ? required.amount1 - recovered1 : 0n
  const refund0 = recovered0 > required.amount0 ? recovered0 - required.amount0 : 0n
  const refund1 = recovered1 > required.amount1 ? recovered1 - required.amount1 : 0n

  const [route0, route1] = await resolveSideRoutes(client, {
    token0Id: pool.token0,
    token1Id: pool.token1,
    program,
    token0Route: params.token0Route,
    token1Route: params.token1Route,
  })
  const functionName = selectRebalanceEntry({
    wrapped0: route0.wrapped,
    wrapped1: route1.wrapped,
    funds0: funded0 > 0n,
    funds1: funded1 > 0n,
  })

  return {
    tickLower,
    tickUpper,
    oldLiquidity: position.liquidity,
    recovered0,
    recovered1,
    required0: required.amount0,
    required1: required.amount1,
    funded0,
    funded1,
    refund0,
    refund1,
    liquidityTarget: params.liquidityTarget,
    functionName,
  }
}

/**
 * Parameters for {@link rebalancePosition}.
 *
 * @property poolKey Pool the position belongs to.
 * @property tickLower Lower bound of the successor range, before spacing
 *   alignment.
 * @property tickUpper Upper bound of the successor range.
 * @property liquidityTarget Exact liquidity of the successor position (u128).
 * @property positionTokenId Which position to rebalance, by `token_id`.
 *   Optional on the local path when `positionRecord` (or the pool's first
 *   unspent position) identifies it; REQUIRED for wallet accounts, whose
 *   record inputs are opaque.
 * @property positionRecord Explicit PositionNFT record input (plaintext
 *   literal, or a `record` InputRequest for wallet signers — REQUIRED for
 *   wallets).
 * @property token0Record Funding record for token0, needed only when the
 *   quote funds that side (plaintext literal, or a `record` InputRequest for
 *   wallet signers — REQUIRED for wallets then). A wrapped side's record is
 *   the UNDERLYING asset's record, never a wrapper record.
 * @property token1Record Funding record for token1, same rule.
 * @property token0Program Program holding the caller's token0 funding
 *   records. Optional — defaults like {@link mint}.
 * @property token1Program Program holding the caller's token1 funding records.
 * @property token0Route Pre-resolved route override for token0.
 * @property token1Route Pre-resolved route override for token1.
 * @property proofs Freezelist proof provider for populated freezelists.
 *   Defaults to the empty-tree witness on every proof slot (owner and
 *   withdrawal against the AMM list, plus wrapper sender proofs on funded
 *   wrapped sides and receiver proofs on every wrapped side).
 * @property tickLowerHint Explicit insert hint. Defaults to `pickInsertHint`.
 * @property tickUpperHint Explicit insert hint for the upper bound.
 * @property initializedTicks The pool's initialized ticks, or a supplier for
 *   them, forwarded to `pickInsertHint` like {@link mint}.
 * @property deadlineOffsetBlocks Blocks until the request expires. Defaults
 *   to `getDeadline`'s offset (100).
 * @property nonce Explicit field nonce. Defaults to crypto-random.
 * @property imports Program sources for dynamic-dispatch dependencies, as in
 *   {@link mint}.
 * @property program shield_swap core program override for the reads.
 *   Defaults to `shield_swap.aleo`. The call always targets
 *   `shield_swap_rebalance_router.aleo`.
 */
export type RebalancePositionParameters = {
  poolKey: string
  tickLower: number
  tickUpper: number
  liquidityTarget: bigint
  positionTokenId?: string
  positionRecord?: string | InputRequest
  token0Record?: string | InputRequest
  token1Record?: string | InputRequest
  token0Program?: string
  token1Program?: string
  token0Route?: TokenRoute
  token1Route?: TokenRoute
  proofs?: ProofProvider
  tickLowerHint?: number
  tickUpperHint?: number
  initializedTicks?: PickInsertHintParameters['initializedTicks']
  deadlineOffsetBlocks?: number
  nonce?: string
  imports?: Record<string, string>
  program?: string
}

/**
 * The rebalance's essentials.
 *
 * @property positionTokenId The successor position's `token_id` (a public
 *   output). Known immediately on the local path; `undefined` on the wallet
 *   path — recover it from the confirmed transaction or `getOwnedPositions`.
 * @property transactionId The rebalance transaction's id.
 * @property quote The exact accounting the transaction submitted.
 */
export type RebalancePositionReturnType = {
  positionTokenId?: string
  transactionId: string
  quote: PreviewRebalanceReturnType
}

/**
 * Moves a position to a new range atomically: close, refund, remint.
 *
 * Consumes the PositionNFT, recovers the old range's principal and owed
 * balances, opens the successor range at exactly `liquidityTarget`, pays any
 * surplus to the position's `withdrawal` address as private records, and
 * takes any shortfall from the caller's funding records. The successor NFT
 * keeps the position's owner and withdrawal address. Every call goes through
 * `shield_swap_rebalance_router.aleo`; the entrypoint follows the pair's
 * wrapped-ness and the funded sides ({@link selectRebalanceEntry}).
 *
 * The quote is computed here, against live state, in the same call — the
 * contract asserts it exactly at finalize time, so a price move or fee
 * accrual between quote and finalize aborts the transaction without moving
 * funds. Use {@link previewRebalance} first to learn which sides need
 * funding records.
 *
 * Signer paths mirror {@link collect}: a local account auto-selects the
 * position and funding records; a wallet account must supply
 * `positionTokenId`, `positionRecord`, and a record for each funded side.
 *
 * Hits the network: pool/slot/position reads, route reads (cached), hint and
 * deadline reads, record scans (local), and the transaction. Signs, and on
 * the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The position, the successor range, the liquidity target, and
 *   optional overrides.
 * @returns The successor position's token id (local path), the transaction
 *   id, and the submitted quote.
 * @throws When the pool or position does not exist; when the aligned range
 *   is empty; when a funded side's record is missing (wallet) or no unspent
 *   record covers it (local); and on transport/proving errors.
 *
 * @example
 * const { positionTokenId } = await rebalancePosition(client, {
 *   poolKey, positionTokenId: oldId,
 *   tickLower: -1200, tickUpper: -600, liquidityTarget: 500_000n,
 * })
 */
export async function rebalancePosition(
  client: Client,
  params: RebalancePositionParameters,
): Promise<RebalancePositionReturnType> {
  const program = params.program ?? SHIELD_SWAP

  const pool = await requirePool(client, params.poolKey, program)
  const account = requireAccount(client, 'rebalancePosition')
  const isLocal = account.type === 'local'

  // Resolve the position input first: the token id keys the state reads and
  // the withdrawal address inside the record is a proof subject below.
  let positionInput: TransactionInput
  let positionTokenId = params.positionTokenId
  if (isLocal) {
    const { plaintext } = await resolvePositionRecord(client, {
      positionRecord: params.positionRecord,
      program,
      poolKey: params.poolKey,
      tokenId: params.positionTokenId,
    })
    positionInput = plaintext
    positionTokenId ??= fieldFromPlaintext(plaintext, 'token_id')
  } else {
    if (params.positionRecord === undefined || params.positionTokenId === undefined) {
      throw new Error('Wallet accounts must provide positionTokenId and positionRecord')
    }
    positionInput = params.positionRecord
  }
  if (!positionTokenId) {
    throw new Error('positionTokenId is required when the position record does not carry a parseable token_id')
  }

  const quote = await previewRebalance(client, {
    poolKey: params.poolKey,
    positionTokenId,
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
    liquidityTarget: params.liquidityTarget,
    ...(params.token0Route ? { token0Route: params.token0Route } : {}),
    ...(params.token1Route ? { token1Route: params.token1Route } : {}),
    program,
  })

  const [route0, route1] = await resolveSideRoutes(client, {
    token0Id: pool.token0,
    token1Id: pool.token1,
    program,
    token0Route: params.token0Route,
    token1Route: params.token1Route,
  })

  const ticks = params.initializedTicks ? { initializedTicks: params.initializedTicks } : {}
  const tickLowerHint =
    params.tickLowerHint ??
    (await pickInsertHint(client, { poolKey: params.poolKey, targetTick: quote.tickLower, program, ...ticks }))
  const upperPredecessor =
    params.tickUpperHint ??
    (await pickInsertHint(client, { poolKey: params.poolKey, targetTick: quote.tickUpper, program, ...ticks }))
  // Same correction as mint: the finalize inserts tick_lower first, so with no
  // initialized tick between the bounds the upper hint is the fresh lower tick.
  const tickUpperHint =
    params.tickUpperHint === undefined && quote.tickLower > upperPredecessor ? quote.tickLower : upperPredecessor

  const deadline = await getDeadline(client, {
    ...(params.deadlineOffsetBlocks === undefined ? {} : { offsetBlocks: params.deadlineOffsetBlocks }),
  })
  const mint = {
    pool: params.poolKey,
    tickLower: quote.tickLower,
    tickUpper: quote.tickUpper,
    amount0Desired: quote.required0,
    amount1Desired: quote.required1,
    amount0Min: quote.required0,
    amount1Min: quote.required1,
    tickLowerHint,
    tickUpperHint,
  }
  const request = formatRebalanceRequest({
    oldLiquidity: quote.oldLiquidity,
    recovered0: quote.recovered0,
    recovered1: quote.recovered1,
    funded0: quote.funded0,
    funded1: quote.funded1,
    refund0: quote.refund0,
    refund1: quote.refund1,
    liquidityTarget: quote.liquidityTarget,
    mint,
    deadline,
  })
  const assets = formatRebalanceAssets({
    token0Id: pool.token0,
    underlying0Id: route0.wrapped ? route0.underlyingId : pool.token0,
    token1Id: pool.token1,
    underlying1Id: route1.wrapped ? route1.underlyingId : pool.token1,
  })

  // Refunds and the reminted range pay the NFT's withdrawal address; opaque
  // wallet records degrade the proof subject to the signer — irrelevant while
  // proofs default to the empty witness.
  const receiver =
    (typeof positionInput === 'string' ? fieldFromPlaintext(positionInput, 'withdrawal') : undefined) ??
    account.address
  const [ownerProofs, withdrawalProofs, senderProof0, senderProof1, receiverProof0, receiverProof1] =
    await Promise.all([
      ammProofPair(params.proofs, account.address),
      ammProofPair(params.proofs, receiver),
      wrapperSenderProof(params.proofs, route0, account.address),
      wrapperSenderProof(params.proofs, route1, account.address),
      wrapperSenderProof(params.proofs, route0, receiver),
      wrapperSenderProof(params.proofs, route1, receiver),
    ])

  const sides = [
    { route: route0, funded: quote.funded0, record: params.token0Record, override: params.token0Program, senderProof: senderProof0, receiverProof: receiverProof0 },
    { route: route1, funded: quote.funded1, record: params.token1Record, override: params.token1Program, senderProof: senderProof1, receiverProof: receiverProof1 },
  ]

  // Slot rule shared by all 14 entries: each funded side's record (with the
  // wrapped side's sender proof right after it), then every wrapped side's
  // receiver proof, then the common tail.
  const fundingInputs: TransactionInput[] = []
  for (const [index, side] of sides.entries()) {
    if (side.funded === 0n) continue
    let record = side.record
    if (record === undefined) {
      if (!isLocal) {
        throw new Error(`Wallet accounts must provide token${index}Record — the quote funds token${index} with ${side.funded}`)
      }
      record = await autoSelectSideRecord(client, side.route, side.funded, side.override)
    } else if (isLocal && typeof record === 'object') {
      throw new Error('Local accounts cannot use InputRequests — pass record plaintext literals instead')
    }
    fundingInputs.push(record)
    if (side.route.wrapped) fundingInputs.push(side.senderProof!)
  }
  const receiverProofInputs: string[] = sides
    .filter((side) => side.route.wrapped)
    .map((side) => side.receiverProof!)

  const nonce = params.nonce ?? generateFieldNonce()
  const inputs: TransactionInput[] = [
    positionInput,
    nonce,
    ...fundingInputs,
    ...receiverProofInputs,
    request,
    assets,
    ownerProofs,
    withdrawalProofs,
  ]

  if (isLocal) {
    const result = await executeContract(client, {
      program: SHIELD_SWAP_REBALANCE_ROUTER,
      function: quote.functionName,
      imports: params.imports,
      inputs,
    })
    const newPositionTokenId = requireFieldOutput(result.outputs, quote.functionName)
    return { positionTokenId: newPositionTokenId, transactionId: result.transactionId, quote }
  }

  const transactionId = await writeContract(client, {
    program: SHIELD_SWAP_REBALANCE_ROUTER,
    function: quote.functionName,
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  return { transactionId, quote }
}

/** Extracts a named field from a PositionNFT plaintext, if parseable. */
function fieldFromPlaintext(plaintext: string, field: 'withdrawal' | 'token_id'): string | undefined {
  try {
    const raw = parseRecord(plaintext).fields[field]?.value
    if (typeof raw === 'string') return raw
    if (typeof raw === 'bigint') return `${raw}field`
    return undefined
  } catch {
    return undefined
  }
}
