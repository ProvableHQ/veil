import {
  executeContract,
  writeContract,
  parseRecord,
  type Client,
  type InputRequest,
  type TransactionInput,
} from '@provablehq/veil-core'
import { requireAccount, requirePool } from '../../utils/guards.js'
import { resolvePositionRecord } from '../../utils/records.js'
import {
  formatMintPositionRequest,
  formatRebalanceAssets,
  formatRebalanceRequest,
  generateFieldNonce,
  getDeadline,
} from '../../utils/params.js'
import { requireFieldOutput } from '../../utils/outputs.js'
import { pickInsertHint, type PickInsertHintParameters } from '../../utils/tick-hints.js'
import type { TokenRoute } from '../../utils/routing.js'
import type { ProofProvider } from '../../utils/proofs.js'
import { SHIELD_SWAP, SHIELD_SWAP_REBALANCE_ROUTER } from '../../constants.js'
import {
  ammProofPair,
  autoSelectSideRecord,
  resolveSideRoutes,
  wrapperSenderProof,
} from './internal.js'
import {
  planRebalance,
  selectRebalanceEntry,
  type RebalancePlan,
  type RebalancePoolState,
  type RebalancePositionState,
  type RebalanceSlotState,
  type RebalanceTickState,
} from './planRebalance.js'

// The plan is only valid at the pool price it was built against, so a stale
// transaction almost certainly reverts anyway — a short deadline fails it
// cheaply instead.
const REBALANCE_DEADLINE_OFFSET_BLOCKS = 20

/**
 * Parameters for {@link rebalancePosition} — one flat object, three ways to
 * fill it.
 *
 * The simplest call names the pool, position, successor range, and one
 * sizing mode: an exact `liquidityTarget`, or a `maxFunding0`/`maxFunding1`
 * budget ({@link RebalanceSizing} explains both). The plan is then built in
 * the same call. Callers with their own state source add any of the
 * pre-read state fields. Callers with their own accounting spread a
 * {@link RebalancePlan} into the call (`{ ...plan, imports }`) — when the
 * derived amounts are present, they are submitted verbatim and nothing is
 * recomputed. The derived amounts travel all-or-nothing: supplying some but
 * not all of them is an error, never a partial recompute.
 *
 * @property poolKey Pool the position belongs to.
 * @property tickLower Lower bound of the successor range. Aligned to the
 *   pool's spacing when the plan is built here; used verbatim when the
 *   derived amounts are supplied.
 * @property tickUpper Upper bound of the successor range, same rule.
 * @property positionTokenId Which position to rebalance, by `token_id`.
 *   Optional on the local path when `positionRecord` (or the pool's first
 *   unspent position) identifies it; REQUIRED for wallet accounts, whose
 *   record inputs are opaque.
 * @property liquidityTarget Exact successor liquidity (u128). One of the two
 *   sizing modes; also carried by a spread plan.
 * @property maxFunding0 Token0 funding budget (u128) — the other sizing mode.
 * @property maxFunding1 Token1 funding budget (u128).
 * @property oldLiquidity Derived: the position's full liquidity. Spread from
 *   a plan, or computed here.
 * @property recovered0 Derived: exact token0 the close returns.
 * @property recovered1 Derived: exact token1 the close returns.
 * @property required0 Derived: exact token0 the successor range needs.
 * @property required1 Derived: exact token1 the successor range needs.
 * @property funded0 Derived: token0 the caller supplies.
 * @property funded1 Derived: token1 the caller supplies.
 * @property refund0 Derived: token0 surplus paid to the withdrawal address.
 * @property refund1 Derived: token1 surplus paid back.
 * @property functionName Derived: the router transition to call. Optional
 *   even with the other derived amounts — computed from the token routes and
 *   funded sides when absent.
 * @property feesAccrued0 Advisory plan field; accepted from a spread and ignored.
 * @property feesAccrued1 Advisory plan field; accepted and ignored.
 * @property pool Pre-read pool state — see {@link RebalanceStateOverrides}.
 * @property slot Pre-read slot state.
 * @property position Pre-read position state.
 * @property lowerTick Pre-read lower boundary tick state.
 * @property upperTick Pre-read upper boundary tick state.
 * @property positionRecord Explicit PositionNFT record input (plaintext
 *   literal, or a `record` InputRequest for wallet signers — REQUIRED for
 *   wallets).
 * @property token0Record Funding record for token0, needed only when the
 *   plan funds that side (plaintext literal, or a `record` InputRequest for
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
 *   to 20 — keep it short: a stale transaction almost certainly reverts on
 *   price mismatch anyway, and the deadline fails it cheaply.
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
  positionTokenId?: string
  liquidityTarget?: bigint
  maxFunding0?: bigint
  maxFunding1?: bigint
  oldLiquidity?: bigint
  recovered0?: bigint
  recovered1?: bigint
  required0?: bigint
  required1?: bigint
  funded0?: bigint
  funded1?: bigint
  refund0?: bigint
  refund1?: bigint
  functionName?: string
  feesAccrued0?: bigint
  feesAccrued1?: bigint
  pool?: RebalancePoolState
  slot?: RebalanceSlotState
  position?: RebalancePositionState
  lowerTick?: RebalanceTickState
  upperTick?: RebalanceTickState
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

// The plan's derived amounts travel together: a spread RebalancePlan supplies
// every one of these, and a partial set means a construction mistake.
const DERIVED_PLAN_FIELDS = [
  'oldLiquidity',
  'recovered0',
  'recovered1',
  'required0',
  'required1',
  'funded0',
  'funded1',
  'refund0',
  'refund1',
] as const

/**
 * The rebalance's essentials.
 *
 * @property positionTokenId The successor position's `token_id` (a public
 *   output). Known immediately on the local path; `undefined` on the wallet
 *   path — recover it from the confirmed transaction or `getOwnedPositions`.
 * @property transactionId The rebalance transaction's id.
 * @property plan The exact accounting the transaction submitted.
 */
export type RebalancePositionReturnType = {
  positionTokenId?: string
  transactionId: string
  plan: RebalancePlan
}

/**
 * Rebalances token positions in a pool in a single transaction.
 *
 * If a transaction is successful, this function burns the old position,
 * collects the principal and accrued fees, optionally adds funds from the
 * caller's private balance, and mints the new position with the same owner
 * and withdrawal address; any surplus arrives as private records for the
 * withdrawal address. The operation is atomic, so failed transactions abort
 * all operations, leaving the pool in the same state before the call.
 * Callers specify one sizing mode ({@link RebalanceSizing}): an exact
 * `liquidityTarget`, or a `maxFunding` budget per token that the planner
 * solves for the largest liquidity it supports — or spread a prebuilt
 * {@link RebalancePlan} into the call to skip the derivation entirely.
 *
 * Note every derived amount is a function of the pool price at the block
 * where a transaction executes. If any trade moves the pool price between
 * building and execution, the on-chain assertions fail and the whole
 * transaction reverts — no funds move, but the caller pays the transaction
 * fee. Expect rebalances on active pools to occasionally revert and in those
 * cases, simply rebuild and resubmit. Ensure to set `deadlineOffsetBlocks`
 * low to minimize this risk (the default is 20 blocks).
 *
 * A local account auto-selects the position and funding records; a wallet
 * account must supply `positionTokenId`, `positionRecord`, and a record for
 * each funded side (the plan's `funded0`/`funded1` say which and how much).
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The position, range, and sizing — or a spread plan — plus
 *   optional execution overrides.
 * @returns The successor position's token id (local path), the transaction
 *   id, and the submitted plan.
 * @throws When the pool, position, or a boundary tick does not exist; when
 *   the aligned range is empty; when a funded side's record is missing
 *   (wallet) or no unspent record covers it (local); and on
 *   transport/proving errors.
 *
 * @example
 * const { positionTokenId } = await rebalancePosition(client, {
 *   poolKey, positionTokenId: oldId,
 *   tickLower: -1200, tickUpper: -600, maxFunding0: 0n, maxFunding1: 0n,
 * })
 */
export async function rebalancePosition(
  client: Client,
  params: RebalancePositionParameters,
): Promise<RebalancePositionReturnType> {
  const program = params.program ?? SHIELD_SWAP
  const poolKey = params.poolKey

  const suppliedDerived = DERIVED_PLAN_FIELDS.filter((field) => params[field] !== undefined)
  if (suppliedDerived.length > 0 && suppliedDerived.length < DERIVED_PLAN_FIELDS.length) {
    const missing = DERIVED_PLAN_FIELDS.filter((field) => params[field] === undefined)
    throw new Error(`The derived plan amounts travel together — missing ${missing.join(', ')}`)
  }
  const hasDerived = suppliedDerived.length === DERIVED_PLAN_FIELDS.length
  if (hasDerived && params.liquidityTarget === undefined) {
    throw new Error('A spread plan carries liquidityTarget — it is missing alongside the derived amounts')
  }

  const pool = await requirePool(client, poolKey, program)
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
      poolKey,
      tokenId: positionTokenId,
    })
    positionInput = plaintext
    positionTokenId ??= fieldFromPlaintext(plaintext, 'token_id')
  } else {
    if (params.positionRecord === undefined || positionTokenId === undefined) {
      throw new Error('Wallet accounts must provide positionRecord and positionTokenId')
    }
    positionInput = params.positionRecord
  }
  if (!positionTokenId) {
    throw new Error('positionTokenId is required when the position record does not carry a parseable token_id')
  }

  const plan: RebalancePlan = hasDerived
    ? {
        poolKey,
        positionTokenId,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        oldLiquidity: params.oldLiquidity!,
        recovered0: params.recovered0!,
        recovered1: params.recovered1!,
        required0: params.required0!,
        required1: params.required1!,
        funded0: params.funded0!,
        funded1: params.funded1!,
        refund0: params.refund0!,
        refund1: params.refund1!,
        liquidityTarget: params.liquidityTarget!,
        ...(params.functionName === undefined ? {} : { functionName: params.functionName }),
      }
    : await planRebalance(client, {
        poolKey,
        positionTokenId,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        ...(params.liquidityTarget !== undefined
          ? { liquidityTarget: params.liquidityTarget }
          : { maxFunding0: params.maxFunding0!, maxFunding1: params.maxFunding1! }),
        ...(params.pool ? { pool: params.pool } : {}),
        ...(params.slot ? { slot: params.slot } : {}),
        ...(params.position ? { position: params.position } : {}),
        ...(params.lowerTick ? { lowerTick: params.lowerTick } : {}),
        ...(params.upperTick ? { upperTick: params.upperTick } : {}),
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
    (await pickInsertHint(client, { poolKey, targetTick: plan.tickLower, program, ...ticks }))
  const upperPredecessor =
    params.tickUpperHint ??
    (await pickInsertHint(client, { poolKey, targetTick: plan.tickUpper, program, ...ticks }))
  // Same correction as mint: the finalize inserts tick_lower first, so with no
  // initialized tick between the bounds the upper hint is the fresh lower tick.
  const tickUpperHint =
    params.tickUpperHint === undefined && plan.tickLower > upperPredecessor ? plan.tickLower : upperPredecessor

  const deadline = await getDeadline(client, {
    offsetBlocks: params.deadlineOffsetBlocks ?? REBALANCE_DEADLINE_OFFSET_BLOCKS,
  })
  const request = formatRebalanceRequest({
    oldLiquidity: plan.oldLiquidity,
    recovered0: plan.recovered0,
    recovered1: plan.recovered1,
    funded0: plan.funded0,
    funded1: plan.funded1,
    refund0: plan.refund0,
    refund1: plan.refund1,
    liquidityTarget: plan.liquidityTarget,
    mint: {
      pool: poolKey,
      tickLower: plan.tickLower,
      tickUpper: plan.tickUpper,
      amount0Desired: plan.required0,
      amount1Desired: plan.required1,
      amount0Min: plan.required0,
      amount1Min: plan.required1,
      tickLowerHint,
      tickUpperHint,
    },
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
    { route: route0, funded: plan.funded0, record: params.token0Record, override: params.token0Program, senderProof: senderProof0, receiverProof: receiverProof0 },
    { route: route1, funded: plan.funded1, record: params.token1Record, override: params.token1Program, senderProof: senderProof1, receiverProof: receiverProof1 },
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
        throw new Error(`Wallet accounts must provide token${index}Record — the plan funds token${index} with ${side.funded}`)
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

  const functionName =
    plan.functionName ??
    selectRebalanceEntry({
      wrapped0: route0.wrapped,
      wrapped1: route1.wrapped,
      funds0: plan.funded0 > 0n,
      funds1: plan.funded1 > 0n,
    })

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
      function: functionName,
      imports: params.imports,
      inputs,
    })
    const newPositionTokenId = requireFieldOutput(result.outputs, functionName)
    return { positionTokenId: newPositionTokenId, transactionId: result.transactionId, plan: { ...plan, functionName } }
  }

  const transactionId = await writeContract(client, {
    program: SHIELD_SWAP_REBALANCE_ROUTER,
    function: functionName,
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  return { transactionId, plan: { ...plan, functionName } }
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
