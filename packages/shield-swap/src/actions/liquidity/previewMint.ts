import type { Client } from '@provablehq/veil-core'
import { requirePool, requireSlot } from '../../utils/guards.js'
import { getFeeToTickSpacing } from '../reads/getFeeToTickSpacing.js'
import { roundTickToSpacing } from '../../utils/tick-math.js'
import { amountsForLiquidity, getSqrtPriceAtTickX128, liquidityForAmounts } from '../../utils/q128.js'
import { SHIELD_SWAP } from '../../constants.js'

/** Natural log of the tick base (1.0001), the step between adjacent ticks. */
const LOG_TICK_BASE = Math.log(1.0001)

/** Range width used when a caller names neither explicit bounds nor a width. */
const DEFAULT_RANGE_PERCENT = 5

/**
 * Parameters for {@link previewMint}.
 *
 * @property poolKey Pool the position would be opened in.
 * @property amount0Desired Raw base units of token0 available to deposit
 *   (u128). The preview never exceeds it.
 * @property amount1Desired Raw base units of token1 available to deposit (u128).
 * @property tickLower Lower bound of the range, before spacing alignment.
 *   Optional — supply it together with `tickUpper`, or neither and let
 *   `rangePercent` place the range around the pool's active tick.
 * @property tickUpper Upper bound of the range, before spacing alignment.
 * @property rangePercent Half-width of the range as a percentage of the pool's
 *   current price, so 5 asks for roughly ±5%. Defaults to 5, and is ignored
 *   when explicit bounds are given. Must be greater than 0 and less than 100 —
 *   at 100 the lower bound is a price of zero, which has no tick.
 * @property program shield_swap program to read from. Defaults to
 *   `shield_swap.aleo`.
 */
export type PreviewMintParameters = {
  poolKey: string
  amount0Desired: bigint
  amount1Desired: bigint
  tickLower?: number
  tickUpper?: number
  rangePercent?: number
  program?: string
}

/**
 * What a mint would open, priced against the pool's live state.
 *
 * All amounts are raw base units of the pool tokens (u128 on chain, `bigint`
 * here) — render them with each token's decimals.
 *
 * @property poolKey The pool the preview was taken against.
 * @property token0Id The pair's first AMM token id field literal, in the order
 *   `amount0Desired` and `amount0` refer to.
 * @property token1Id The pair's second AMM token id field literal.
 * @property fee The pool's fee in pips (u16).
 * @property tickSpacing The pool's own tick spacing (u32) — the grid the bounds
 *   were aligned to, and the one `mint` aligns against.
 * @property feeTierSpacing The spacing the `fee_to_tick_spacing` registry binds
 *   to this pool's fee, or `null` when the fee carries no binding. Equal to
 *   `tickSpacing` on a healthy pool; a mismatch means the pool holds positions
 *   on a grid the registry no longer describes, and the pool's own spacing is
 *   what governs.
 * @property tickCurrent The pool's active tick (i32) at the time of the read.
 * @property tickLower Lower bound after alignment — what `mint` would use.
 * @property tickUpper Upper bound after alignment.
 * @property inRange Whether the active tick sits inside the aligned bounds. A
 *   position out of range earns no fees until the price moves into it, and is
 *   funded from one side only.
 * @property liquidity The liquidity the deposit would back (u128), floored.
 *   Zero means the budget backs nothing here — one side empty on an in-range
 *   position, or amounts that are dust for a range this wide. A mint would still
 *   cost a fee and open nothing, so treat it as "deposit more, or narrow the
 *   range" rather than as a position to submit.
 * @property amount0 Token0 the mint would actually consume — at or below
 *   `amount0Desired`, and 0 when the price sits at or above the range.
 * @property amount1 Token1 the mint would actually consume, same bound.
 * @property amount0Desired The token0 budget the preview was taken with, echoed
 *   so a caller can show what went unused.
 * @property amount1Desired The token1 budget, echoed.
 */
export type PreviewMintReturnType = {
  poolKey: string
  token0Id: string
  token1Id: string
  fee: number
  tickSpacing: number
  feeTierSpacing: number | null
  tickCurrent: number
  tickLower: number
  tickUpper: number
  inRange: boolean
  liquidity: bigint
  amount0: bigint
  amount1: bigint
  amount0Desired: bigint
  amount1Desired: bigint
}

/**
 * Previews the position a mint would open, without signing anything.
 *
 * Answers the three questions a depositor has before spending: where the range
 * lands once it is aligned to the pool's tick spacing, what liquidity the
 * deposit backs there, and how much of each side is actually consumed —
 * because a pair of amounts that balances at one price falls short at another,
 * and the mint takes only what the range needs.
 *
 * Composed from the same primitives the mint and the chain use: the bounds come
 * from `roundTickToSpacing`, the liquidity from `liquidityForAmounts` against
 * the live `sqrt_price`, and the consumed amounts from `amountsForLiquidity`
 * with deposit-side rounding, so neither side lands a base unit short. The
 * result is what `mint` would compute, up to a trade landing between this read
 * and the finalize.
 *
 * A `rangePercent` width is converted to a tick offset in floating point, since
 * a percentage of price is not a whole number of ticks. The bounds returned are
 * the aligned ones, which is the range the mint opens — a narrow request can
 * therefore realize as a wider one.
 *
 * Hits the network: three mapping reads (`pools`, `slots`, and
 * `fee_to_tick_spacing`). Signs nothing and writes nothing.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool, the deposit budget, and either explicit bounds or a
 *   range width.
 * @returns The aligned bounds, the resulting liquidity, the amounts consumed,
 *   and the pool state they were derived from.
 * @throws When the pool or its slot does not exist; when only one of
 *   `tickLower`/`tickUpper` is given; when `rangePercent` is outside
 *   `(0, 100)`; when explicit bounds are empty after alignment; and when a
 *   percentage range collapses to a single aligned tick.
 *
 * @example
 * const preview = await client.previewMint({
 *   poolKey,
 *   amount0Desired: 10n ** 17n,
 *   amount1Desired: 200_000n,
 *   rangePercent: 5,
 * })
 * if (preview.liquidity === 0n) throw new Error('deposit is dust for that range')
 * await client.mint({
 *   poolKey,
 *   tickLower: preview.tickLower,
 *   tickUpper: preview.tickUpper,
 *   amount0Desired: preview.amount0,
 *   amount1Desired: preview.amount1,
 *   recipient: account.address,
 *   withdrawal: account.address,
 * })
 */
export async function previewMint(
  client: Client,
  params: PreviewMintParameters,
): Promise<PreviewMintReturnType> {
  const program = params.program ?? SHIELD_SWAP

  if ((params.tickLower === undefined) !== (params.tickUpper === undefined)) {
    throw new Error('previewMint takes tickLower and tickUpper together, or neither — pass both or use rangePercent')
  }

  const [pool, slot] = await Promise.all([
    requirePool(client, params.poolKey, program),
    requireSlot(client, params.poolKey, program),
  ])
  // The pool's own spacing governs, because that is what `mint` aligns
  // against. The registry's binding is reported alongside it so a caller can
  // see a pool that has drifted from the fee tier it was created under.
  const spacing = slot.tick_spacing
  const feeTierSpacing = await getFeeToTickSpacing(client, { fee: pool.fee, program })

  const { tickLower, tickUpper } = resolveBounds(params, slot.tick, spacing)

  // Start from the budget, the direction a depositor starts from: ask what
  // liquidity those amounts back over this range, then report exactly what that
  // liquidity consumes.
  const range = {
    sqrtPriceX128: slot.sqrt_price,
    sqrtLowerX128: getSqrtPriceAtTickX128(tickLower),
    sqrtUpperX128: getSqrtPriceAtTickX128(tickUpper),
  }
  const liquidity = liquidityForAmounts({
    ...range,
    amount0: params.amount0Desired,
    amount1: params.amount1Desired,
  })
  // `true` is the deposit-side rounding, so neither side lands a hair short of
  // what the range requires and reverts the mint for want of a base unit.
  const { amount0, amount1 } = amountsForLiquidity({ ...range, liquidity, roundUp: true })

  return {
    poolKey: params.poolKey,
    token0Id: pool.token0,
    token1Id: pool.token1,
    fee: pool.fee,
    tickSpacing: spacing,
    feeTierSpacing,
    tickCurrent: slot.tick,
    tickLower,
    tickUpper,
    inRange: slot.tick >= tickLower && slot.tick < tickUpper,
    liquidity,
    amount0,
    amount1,
    amount0Desired: params.amount0Desired,
    amount1Desired: params.amount1Desired,
  }
}

/**
 * Resolves the aligned range from explicit bounds or a percentage width.
 *
 * Both paths floor onto the spacing grid, matching what `mint` does to the
 * bounds it is handed — so the range previewed is the range opened. Internal to
 * {@link previewMint}; pure and local.
 *
 * @param params The caller's bounds or width.
 * @param tickCurrent The pool's active tick, which a percentage width centers on.
 * @param spacing The pool's tick spacing.
 * @returns The aligned bounds.
 * @throws When the resulting range is empty, which for a percentage width means
 *   the width is finer than one spacing step.
 */
function resolveBounds(
  params: PreviewMintParameters,
  tickCurrent: number,
  spacing: number,
): { tickLower: number; tickUpper: number } {
  if (params.tickLower !== undefined && params.tickUpper !== undefined) {
    const tickLower = roundTickToSpacing(params.tickLower, spacing)
    const tickUpper = roundTickToSpacing(params.tickUpper, spacing)
    if (tickLower >= tickUpper) {
      throw new Error(
        `Ticks [${params.tickLower}, ${params.tickUpper}) align to [${tickLower}, ${tickUpper}) on this ` +
          `pool's spacing of ${spacing}, which is an empty range — widen the bounds to at least one spacing step`,
      )
    }
    return { tickLower, tickUpper }
  }

  const percent = params.rangePercent ?? DEFAULT_RANGE_PERCENT
  if (!(percent > 0) || percent >= 100) {
    throw new Error(`rangePercent must be greater than 0 and less than 100, got ${percent}`)
  }
  // A percentage of price is not a whole number of ticks, so the offsets are
  // measured in log space and the alignment below lands them on the grid.
  const tickLower = roundTickToSpacing(tickCurrent + Math.log(1 - percent / 100) / LOG_TICK_BASE, spacing)
  const tickUpper = roundTickToSpacing(tickCurrent + Math.log(1 + percent / 100) / LOG_TICK_BASE, spacing)
  if (tickLower >= tickUpper) {
    throw new Error(
      `A ±${percent}% range around tick ${tickCurrent} collapses to a single tick on this pool's ` +
        `spacing of ${spacing} — widen rangePercent, or pass explicit ticks at least ${spacing} apart`,
    )
  }
  return { tickLower, tickUpper }
}
