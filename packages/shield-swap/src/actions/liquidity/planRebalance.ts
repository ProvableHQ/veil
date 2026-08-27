import type { Client } from '@provablehq/veil-core'
import { requirePool, requireSlot } from '../../utils/guards.js'
import { roundTickToSpacing } from '../../utils/tick-math.js'
import {
  amountsForLiquidity,
  feeGrowthInside,
  feeOwed,
  getSqrtPriceAtTickX128,
  liquidityForAmounts,
} from '../../utils/q128.js'
import type { TokenRoute } from '../../utils/routing.js'
import { getPosition } from '../reads/getPosition.js'
import { getTick } from '../reads/getTick.js'
import { SHIELD_SWAP } from '../../constants.js'
import { resolveSideRoutes } from './internal.js'

// The budget round-trip (floor the liquidity, ceil the amounts) can overshoot
// a budget by a rounding unit; each retry lowers the target by one.
const BUDGET_CLAMP_RETRIES = 8

/**
 * Picks which of the router's 14 rebalance transitions to call.
 *
 * The two tokens in a pool can each be a plain Arc20 or a wrapped Arc20 (a
 * wrapper token backed by an underlying asset), and each side either takes a
 * funding record or does not. The router deploys one transition per
 * combination, named for it: `rebalance_wrapped_plain_fund0` serves a
 * wrapped token0 and a plain token1 where only token0 is funded. When both
 * tokens are plain or both are wrapped, one transition named `one` serves a
 * single funded side, whichever it is. Does not touch the network.
 *
 * @param params Each side's wrapper status and whether it takes a funding record.
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
 * How large the successor position should be — exactly one of two modes.
 *
 * `liquidityTarget` mints exactly this liquidity; the planner computes the
 * token amounts it requires, and any shortfall beyond what the old position
 * returns must arrive as funding. `maxFunding0`/`maxFunding1` are instead a
 * per-token budget of additional funds on top of what the old position
 * returns; the planner solves for the largest liquidity that budget
 * supports. Pass `{ maxFunding0: 0n, maxFunding1: 0n }` to rebalance using
 * only recovered funds.
 */
export type RebalanceSizing =
  | { liquidityTarget: bigint; maxFunding0?: undefined; maxFunding1?: undefined }
  | { liquidityTarget?: undefined; maxFunding0: bigint; maxFunding1: bigint }

/**
 * The pool fields the planner consumes — a structural subset of `getPool`'s
 * result, so a caller's own indexer response satisfies it.
 *
 * @property token0 The pool's lower-sorted token id as a `field` literal.
 * @property token1 The pool's higher-sorted token id as a `field` literal.
 */
export type RebalancePoolState = { token0: string; token1: string }

/**
 * The slot fields the planner consumes — a structural subset of `getSlot`'s
 * result.
 *
 * @property tick The pool's active tick (i32).
 * @property tick_spacing The pool's tick grid (u32).
 * @property sqrt_price Current sqrt price, Q128.128 (u256).
 * @property fee_growth_global0_x_128 Global token0 fee accumulator, Q128.128 (u256).
 * @property fee_growth_global1_x_128 Global token1 fee accumulator, Q128.128 (u256).
 */
export type RebalanceSlotState = {
  tick: number
  tick_spacing: number
  sqrt_price: bigint
  fee_growth_global0_x_128: bigint
  fee_growth_global1_x_128: bigint
}

/**
 * The position fields the planner consumes — a structural subset of
 * `getPosition`'s result.
 *
 * @property tick_lower The position's current lower bound (i32).
 * @property tick_upper The position's current upper bound (i32).
 * @property liquidity Live liquidity (u128).
 * @property fee_growth_inside0_last_x_128 Token0 fee checkpoint, Q128.128 (u256).
 * @property fee_growth_inside1_last_x_128 Token1 fee checkpoint, Q128.128 (u256).
 * @property tokens_owed0 Token0 already settled to the position (u128).
 * @property tokens_owed1 Token1 already settled (u128).
 */
export type RebalancePositionState = {
  tick_lower: number
  tick_upper: number
  liquidity: bigint
  fee_growth_inside0_last_x_128: bigint
  fee_growth_inside1_last_x_128: bigint
  tokens_owed0: bigint
  tokens_owed1: bigint
}

/**
 * The boundary-tick fields the planner consumes — a structural subset of
 * `getTick`'s result.
 *
 * @property tick The tick index (i32).
 * @property fee_growth_outside0_x_128 Token0 growth on the far side, Q128.128 (u256).
 * @property fee_growth_outside1_x_128 Token1 growth on the far side, Q128.128 (u256).
 */
export type RebalanceTickState = {
  tick: number
  fee_growth_outside0_x_128: bigint
  fee_growth_outside1_x_128: bigint
}

/**
 * Optional pre-read chain state for the planner.
 *
 * Each supplied field replaces the corresponding chain read, so a caller
 * with its own indexer or REST endpoint can feed the planner a consistent
 * snapshot and skip the node round-trips. Only state is accepted — the
 * derived amounts (`recovered`, `funded`, `refund`, the deposit) are always
 * computed from it, never passed in.
 *
 * @property pool The pool's token pair.
 * @property slot The pool's live price, tick, spacing, and fee accumulators.
 * @property position The position's range, liquidity, checkpoints, and owed balances.
 * @property lowerTick The position's current lower boundary tick state.
 * @property upperTick The position's current upper boundary tick state.
 */
export type RebalanceStateOverrides = {
  pool?: RebalancePoolState
  slot?: RebalanceSlotState
  position?: RebalancePositionState
  lowerTick?: RebalanceTickState
  upperTick?: RebalanceTickState
}

/**
 * Parameters for {@link planRebalance}.
 *
 * @property poolKey Pool the position belongs to.
 * @property positionTokenId The position to rebalance, by `token_id`.
 * @property tickLower Lower bound of the successor range, before spacing
 *   alignment.
 * @property tickUpper Upper bound of the successor range.
 * @property liquidityTarget Exact successor liquidity (u128) — see
 *   {@link RebalanceSizing}.
 * @property maxFunding0 Token0 funding budget (u128) — see {@link RebalanceSizing}.
 * @property maxFunding1 Token1 funding budget (u128).
 * @property pool Pre-read pool state — see {@link RebalanceStateOverrides}.
 * @property slot Pre-read slot state.
 * @property position Pre-read position state.
 * @property lowerTick Pre-read lower boundary tick state.
 * @property upperTick Pre-read upper boundary tick state.
 * @property token0Route Pre-resolved route override for token0 — skips the
 *   on-chain wrapped-ness read (offline/advanced use).
 * @property token1Route Pre-resolved route override for token1.
 * @property program shield_swap core program override. Defaults to
 *   `shield_swap.aleo`.
 */
export type PlanRebalanceParameters = {
  poolKey: string
  positionTokenId: string
  tickLower: number
  tickUpper: number
  token0Route?: TokenRoute
  token1Route?: TokenRoute
  program?: string
} & RebalanceSizing &
  RebalanceStateOverrides

/**
 * The exact rebalance a position can submit against the planned pool state.
 *
 * All amounts are raw base units (u128 on chain, `bigint` here). The
 * contract re-derives and asserts every one of them at execution, so the
 * plan is only submittable while the pool price and the position's fee state
 * are unchanged — do not cache plans; rebuild after any delay.
 *
 * This is a plain data contract, and {@link planRebalance} is one producer
 * of it, not the only one: a caller whose own service computes the same
 * accounting builds the same fields directly. Either way it is spread into
 * {@link rebalancePosition}'s flat parameters (`{ ...plan, imports }`).
 * The exported building blocks (`feeGrowthInside`,
 * `feeOwed`, `amountsForLiquidity`, `liquidityForAmounts`,
 * {@link selectRebalanceEntry}) are the same ones the planner uses.
 *
 * @property poolKey Pool the plan was built against.
 * @property positionTokenId The position it closes.
 * @property tickLower The successor range's lower bound after spacing alignment.
 * @property tickUpper The successor range's upper bound after alignment.
 * @property oldLiquidity The position's live liquidity.
 * @property feesAccrued0 Token0 fees earned since the position's checkpoint,
 *   settled by the close on top of `tokens_owed`. Advisory — execution never
 *   reads it, so hand-built plans can omit it.
 * @property feesAccrued1 Token1 fees earned since the checkpoint. Advisory.
 * @property recovered0 Everything token0 the close returns: principal at the
 *   live price, plus the owed balance, plus `feesAccrued0`.
 * @property recovered1 Everything token1 the close returns.
 * @property required0 Token0 the successor range needs at the live price.
 * @property required1 Token1 the successor range needs.
 * @property funded0 Token0 the caller must supply (`max(required - recovered, 0)`).
 * @property funded1 Token1 the caller must supply.
 * @property refund0 Token0 surplus paid to the withdrawal address.
 * @property refund1 Token1 surplus paid back.
 * @property liquidityTarget The successor position's exact liquidity.
 * @property functionName The rebalance router transition the plan selects.
 *   Optional on hand-built plans — {@link rebalancePosition} derives it from
 *   the token routes and the funded sides when absent.
 */
export type RebalancePlan = {
  poolKey: string
  positionTokenId: string
  tickLower: number
  tickUpper: number
  oldLiquidity: bigint
  feesAccrued0?: bigint
  feesAccrued1?: bigint
  recovered0: bigint
  recovered1: bigint
  required0: bigint
  required1: bigint
  funded0: bigint
  funded1: bigint
  refund0: bigint
  refund1: bigint
  liquidityTarget: bigint
  functionName?: string
}

function sizingOf(params: RebalanceSizing): { target: bigint } | { max0: bigint; max1: bigint } {
  const hasTarget = params.liquidityTarget !== undefined
  const hasBudget = params.maxFunding0 !== undefined || params.maxFunding1 !== undefined
  if (hasTarget === hasBudget) {
    throw new Error('Pass exactly one sizing mode: liquidityTarget, or maxFunding0 and maxFunding1 together')
  }
  if (hasTarget) {
    if (params.liquidityTarget! <= 0n) throw new Error('liquidityTarget must be greater than zero')
    return { target: params.liquidityTarget! }
  }
  if (params.maxFunding0 === undefined || params.maxFunding1 === undefined) {
    throw new Error('Budget sizing needs both maxFunding0 and maxFunding1 (0n is a valid budget)')
  }
  if (params.maxFunding0 < 0n || params.maxFunding1 < 0n) throw new Error('Funding budgets must not be negative')
  return { max0: params.maxFunding0, max1: params.maxFunding1 }
}

/**
 * Builds the exact rebalance a position can submit, priced against pool state.
 *
 * Computes everything the transaction asserts on chain: the full recovery of
 * the old range (principal at the live price, the settled `tokens_owed`
 * balances, and the fees accrued since the position's checkpoints), the
 * successor range's exact deposit, and per token either the funding the
 * caller must add or the surplus refunded to the withdrawal address. Sizing
 * takes either an exact `liquidityTarget` or a `maxFunding` budget per token
 * ({@link RebalanceSizing}); in budget mode the planner solves for the
 * largest liquidity the budget supports.
 *
 * Reads the pool, slot, position, both boundary ticks, and the token routes
 * from the chain; any of them can be supplied pre-read through
 * {@link RebalanceStateOverrides} to skip the corresponding round-trip.
 * Reads only — no signing.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The position, the successor range, and one sizing mode.
 * @returns The plan {@link rebalancePosition} submits.
 * @throws When the pool, position, or a boundary tick does not exist; when
 *   the aligned range is empty; when both or neither sizing modes are given;
 *   or when a funding budget supports no liquidity at all.
 *
 * @example
 * const plan = await planRebalance(client, {
 *   poolKey, positionTokenId, tickLower: -1200, tickUpper: -600,
 *   maxFunding0: 0n, maxFunding1: 0n,
 * })
 */
export async function planRebalance(client: Client, params: PlanRebalanceParameters): Promise<RebalancePlan> {
  const program = params.program ?? SHIELD_SWAP
  const sizing = sizingOf(params)

  const pool = params.pool ?? (await requirePool(client, params.poolKey, program))
  const slot = params.slot ?? (await requireSlot(client, params.poolKey, program))
  const position =
    params.position ?? (await getPosition(client, { positionTokenId: params.positionTokenId, program }))
  if (!position) throw new Error(`Position does not exist: ${params.positionTokenId}`)

  const tickLower = roundTickToSpacing(params.tickLower, slot.tick_spacing)
  const tickUpper = roundTickToSpacing(params.tickUpper, slot.tick_spacing)
  if (tickLower >= tickUpper) {
    throw new Error(`Empty tick range after spacing alignment: [${tickLower}, ${tickUpper})`)
  }

  const [lowerTick, upperTick] = await Promise.all([
    params.lowerTick ?? getTick(client, { poolKey: params.poolKey, tick: position.tick_lower, program }),
    params.upperTick ?? getTick(client, { poolKey: params.poolKey, tick: position.tick_upper, program }),
  ])
  if (!lowerTick || !upperTick) {
    throw new Error(`The position's boundary ticks are not initialized: ${params.positionTokenId}`)
  }

  // The close settles principal, the owed balances, AND the fees accrued
  // since the checkpoints — the contract asserts the position ends at
  // exactly zero owed, so all three components must be in `recovered`.
  const inside0 = feeGrowthInside({
    tickCurrent: slot.tick,
    tickLower: position.tick_lower,
    tickUpper: position.tick_upper,
    feeGrowthOutsideLowerX128: lowerTick.fee_growth_outside0_x_128,
    feeGrowthOutsideUpperX128: upperTick.fee_growth_outside0_x_128,
    feeGrowthGlobalX128: slot.fee_growth_global0_x_128,
  })
  const inside1 = feeGrowthInside({
    tickCurrent: slot.tick,
    tickLower: position.tick_lower,
    tickUpper: position.tick_upper,
    feeGrowthOutsideLowerX128: lowerTick.fee_growth_outside1_x_128,
    feeGrowthOutsideUpperX128: upperTick.fee_growth_outside1_x_128,
    feeGrowthGlobalX128: slot.fee_growth_global1_x_128,
  })
  const feesAccrued0 = feeOwed({
    feeGrowthInsideNowX128: inside0,
    feeGrowthInsideLastX128: position.fee_growth_inside0_last_x_128,
    liquidity: position.liquidity,
  })
  const feesAccrued1 = feeOwed({
    feeGrowthInsideNowX128: inside1,
    feeGrowthInsideLastX128: position.fee_growth_inside1_last_x_128,
    liquidity: position.liquidity,
  })
  const principal = amountsForLiquidity({
    sqrtPriceX128: slot.sqrt_price,
    sqrtLowerX128: getSqrtPriceAtTickX128(position.tick_lower),
    sqrtUpperX128: getSqrtPriceAtTickX128(position.tick_upper),
    liquidity: position.liquidity,
  })
  const recovered0 = principal.amount0 + position.tokens_owed0 + feesAccrued0
  const recovered1 = principal.amount1 + position.tokens_owed1 + feesAccrued1

  const sqrtLowerX128 = getSqrtPriceAtTickX128(tickLower)
  const sqrtUpperX128 = getSqrtPriceAtTickX128(tickUpper)
  // The successor deposit rounds up: the contract takes at most these
  // amounts, and anything the recovered balances do not cover is funding.
  const requiredFor = (liquidity: bigint) =>
    amountsForLiquidity({ sqrtPriceX128: slot.sqrt_price, sqrtLowerX128, sqrtUpperX128, liquidity, roundUp: true })

  let liquidityTarget: bigint
  let required: { amount0: bigint; amount1: bigint }
  if ('target' in sizing) {
    liquidityTarget = sizing.target
    required = requiredFor(liquidityTarget)
  } else {
    liquidityTarget = liquidityForAmounts({
      sqrtPriceX128: slot.sqrt_price,
      sqrtLowerX128,
      sqrtUpperX128,
      amount0: recovered0 + sizing.max0,
      amount1: recovered1 + sizing.max1,
    })
    // The solve floors and the deposit ceils, so the first target can exceed
    // the budget by a rounding unit; step down until it fits.
    let clamped = false
    for (let retry = 0; retry <= BUDGET_CLAMP_RETRIES; retry++) {
      if (liquidityTarget <= 0n) {
        throw new Error('The funding budget supports no liquidity in this range — raise it or narrow the range')
      }
      required = requiredFor(liquidityTarget)
      const over0 = required.amount0 > recovered0 + sizing.max0
      const over1 = required.amount1 > recovered1 + sizing.max1
      if (!over0 && !over1) {
        clamped = true
        break
      }
      liquidityTarget -= 1n
    }
    if (!clamped) {
      throw new Error('Budget sizing did not converge — pass an explicit liquidityTarget')
    }
  }

  const funded0 = required!.amount0 > recovered0 ? required!.amount0 - recovered0 : 0n
  const funded1 = required!.amount1 > recovered1 ? required!.amount1 - recovered1 : 0n
  const refund0 = recovered0 > required!.amount0 ? recovered0 - required!.amount0 : 0n
  const refund1 = recovered1 > required!.amount1 ? recovered1 - required!.amount1 : 0n

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
    poolKey: params.poolKey,
    positionTokenId: params.positionTokenId,
    tickLower,
    tickUpper,
    oldLiquidity: position.liquidity,
    feesAccrued0,
    feesAccrued1,
    recovered0,
    recovered1,
    required0: required!.amount0,
    required1: required!.amount1,
    funded0,
    funded1,
    refund0,
    refund1,
    liquidityTarget,
    functionName,
  }
}
