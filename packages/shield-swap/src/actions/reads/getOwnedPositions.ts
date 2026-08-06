import type { Client, OwnedRecord } from '@provablehq/veil-core'
import { SHIELD_SWAP } from '../../constants.js'
import { listPositionNFTs, type PositionNFTInfo } from '../../utils/records.js'
import { amountsForLiquidity, feeGrowthInside, feeOwed, getSqrtPriceAtTickX128 } from '../../utils/q128.js'
import { getPosition } from './getPosition.js'
import { getSlot, type Slot } from './getSlot.js'
import { getTick } from './getTick.js'
import { getFrozenPosition } from './getFrozenPosition.js'

/**
 * A position's chain-derived state, joined and settled for display.
 *
 * All amounts are raw base units of the pool tokens (u128 on chain,
 * `bigint` here) — convert with each token's decimals before showing them.
 *
 * @property liquidity Live liquidity in the range (u128).
 * @property tokensOwed0 Token0 already settled to the position by earlier
 *   liquidity operations (`positions[token_id].tokens_owed0`).
 * @property tokensOwed1 Token1 counterpart of `tokensOwed0`.
 * @property amount0 Token0 currently backing the liquidity at the pool's
 *   live price (the contract's `view_amounts_for_liquidity`, rounded down).
 * @property amount1 Token1 counterpart of `amount0`.
 * @property uncollectedFees0 Everything `collect` would pay in token0 today:
 *   `tokensOwed0` plus fee growth accrued since the position's checkpoint.
 * @property uncollectedFees1 Token1 counterpart of `uncollectedFees0`.
 */
export interface OwnedPositionState {
  liquidity: bigint
  tokensOwed0: bigint
  tokensOwed1: bigint
  amount0: bigint
  amount1: bigint
  uncollectedFees0: bigint
  uncollectedFees1: bigint
}

/**
 * One of the account's liquidity positions: the private PositionNFT record's
 * identity joined with the position's public chain state.
 *
 * @property positionTokenId The position's `token_id` field literal — the key
 *   for `getPosition`, `increaseLiquidity`, `decreaseLiquidity`, and `collect`.
 * @property poolKey Pool key field literal the position belongs to.
 * @property token0Id The pair's first AMM token id field literal.
 * @property token1Id The pair's second AMM token id field literal.
 * @property tickLower Lower bound tick of the range (i32).
 * @property tickUpper Upper bound tick of the range (i32).
 * @property withdrawal The immutable withdrawal address `collect` pays out to.
 * @property record The PositionNFT record itself — consumable by the
 *   liquidity write actions.
 * @property frozen Whether the admin froze the position (blocks every
 *   liquidity operation until unfrozen).
 * @property closed Whether the position was burned — true when the `positions`
 *   entry is gone AND a record carrying its `token_id` has been consumed. Both
 *   are needed: the entry is missing for an unfinalized mint too, and consumed
 *   records are the normal state of a live position, since every liquidity
 *   operation spends the PositionNFT and re-issues one under the same id. Always
 *   `false` unless `includeClosed` asked for the scan that can prove it.
 * @property state The joined and derived chain state, or `null` while a
 *   fresh mint has not finalized into the `positions` mapping yet. Always
 *   `null` for a closed position, whose entry the burn removed.
 */
export interface OwnedPosition {
  positionTokenId: string
  poolKey: string
  token0Id: string
  token1Id: string
  tickLower: number
  tickUpper: number
  withdrawal: string
  record: OwnedRecord
  frozen: boolean
  closed: boolean
  state: OwnedPositionState | null
}

/**
 * Parameters for {@link getOwnedPositions}.
 *
 * @property poolKey Restricts the listing to one pool's positions. Optional —
 *   without it, every owned position is returned.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 * @property includeClosed Also return positions the account has burned, marked
 *   `closed`. Defaults to `false`. Costs a second record scan over spent
 *   records, so it applies when a caller is reconciling history — a portfolio
 *   view wants only the operable positions the default returns.
 */
export type GetOwnedPositionsParameters = {
  poolKey?: string
  program?: string
  includeClosed?: boolean
}

/** Every owned position — empty when the account holds none. */
export type GetOwnedPositionsReturnType = OwnedPosition[]

/**
 * Joins one scanned PositionNFT with its public chain state and derived
 * values. Internal to the actions layer — {@link getOwnedPositions} and
 * `getOwnedPosition` share it; it is not part of the package surface.
 *
 * Hits the network: `positions`, `frozen_position`, and two `ticks` reads,
 * all in one wave alongside the caller's slot read. The tick reads are
 * speculative — discarded when the position turns out not to be finalized.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The scanned record, the program override, and the pool's
 *   slot — pass the (possibly shared) `getSlot` promise so it resolves
 *   concurrently with this call's own reads.
 * @returns The joined view; `state` is `null` when the `positions` entry or
 *   the pool slot is missing (finalize lag).
 */
export async function resolveOwnedPosition(
  client: Client,
  params: { nft: PositionNFTInfo; program?: string; slot: Slot | null | Promise<Slot | null> },
): Promise<OwnedPosition> {
  const { nft } = params
  const [position, frozenAt, slot, lowerTick, upperTick] = await Promise.all([
    getPosition(client, { positionTokenId: nft.tokenId, program: params.program }),
    getFrozenPosition(client, { positionTokenId: nft.tokenId, program: params.program }),
    params.slot,
    getTick(client, { poolKey: nft.poolKey, tick: nft.tickLower, program: params.program }),
    getTick(client, { poolKey: nft.poolKey, tick: nft.tickUpper, program: params.program }),
  ])

  const base = {
    positionTokenId: nft.tokenId,
    poolKey: nft.poolKey,
    token0Id: nft.token0Id,
    token1Id: nft.token1Id,
    tickLower: nft.tickLower,
    tickUpper: nft.tickUpper,
    withdrawal: nft.withdrawal,
    record: nft.record,
    frozen: frozenAt !== null,
    // Resolving one position cannot prove a burn — that takes the spent scan in
    // getOwnedPositions, which sets this on the entries it builds.
    closed: false,
  }
  // No positions entry yet (finalize lag) — the record side alone.
  if (!position || !slot) return { ...base, state: null }

  const { amount0, amount1 } = amountsForLiquidity({
    sqrtPriceX128: slot.sqrt_price,
    sqrtLowerX128: getSqrtPriceAtTickX128(nft.tickLower),
    sqrtUpperX128: getSqrtPriceAtTickX128(nft.tickUpper),
    liquidity: position.liquidity,
  })
  // An uninitialized boundary tick reads as zero outside-growth; that state
  // is only reachable at zero liquidity, where the fee delta multiplies out.
  const owedSince = (outsideLower: bigint, outsideUpper: bigint, global: bigint, last: bigint) =>
    feeOwed({
      feeGrowthInsideNowX128: feeGrowthInside({
        tickCurrent: slot.tick,
        tickLower: nft.tickLower,
        tickUpper: nft.tickUpper,
        feeGrowthOutsideLowerX128: outsideLower,
        feeGrowthOutsideUpperX128: outsideUpper,
        feeGrowthGlobalX128: global,
      }),
      feeGrowthInsideLastX128: last,
      liquidity: position.liquidity,
    })

  return {
    ...base,
    state: {
      liquidity: position.liquidity,
      tokensOwed0: position.tokens_owed0,
      tokensOwed1: position.tokens_owed1,
      amount0,
      amount1,
      uncollectedFees0:
        position.tokens_owed0 +
        owedSince(
          lowerTick?.fee_growth_outside0_x_128 ?? 0n,
          upperTick?.fee_growth_outside0_x_128 ?? 0n,
          slot.fee_growth_global0_x_128,
          position.fee_growth_inside0_last_x_128,
        ),
      uncollectedFees1:
        position.tokens_owed1 +
        owedSince(
          lowerTick?.fee_growth_outside1_x_128 ?? 0n,
          upperTick?.fee_growth_outside1_x_128 ?? 0n,
          slot.fee_growth_global1_x_128,
          position.fee_growth_inside1_last_x_128,
        ),
    },
  }
}

/**
 * Lists the account's liquidity positions with their live chain state and
 * derived values.
 *
 * Scans the account's unspent PositionNFT records — the private side that
 * names each position — then joins every position with the public
 * `positions`, `frozen_position`, `slots`, and `ticks` mappings and mirrors
 * the contract's two view calculations: the token amounts currently backing
 * the liquidity and the fees `collect` would pay today. The read that lets a
 * wallet or bot show positions without persisting token ids externally.
 * Contrast with `getPosition`, which reads the public mapping for ANY token
 * id on a transport-only client but carries no record, amounts, or fees.
 *
 * Hits the network: one record scan plus up to five mapping reads per
 * position (the pool slot is read once per pool). Requires record access — a
 * connected wallet, or a local account with a record provider — and the
 * optional `@provablehq/sdk` peer for tick-key derivation. Records whose
 * plaintext a privacy-preserving wallet withholds are skipped.
 *
 * The record scan and the mappings lag each other in both directions, and a
 * `null` `state` is where that shows. Just after a mint the record arrives
 * first, so the entry is real and its state is merely pending. Just after a
 * burn the opposite holds: the record scanner marks records spent on its own
 * schedule — measured still serving a burned position more than four minutes
 * after the burn confirmed — so the entry is a position that no longer exists.
 * The public mapping settles which it is, either through `state` here or
 * `getPosition` directly, and a caller rendering a portfolio should treat a
 * `null` state as "not a live position" rather than as a value still loading.
 *
 * @param client A Veil wallet client with record access.
 * @param params Optional pool filter and program override.
 * @returns Every owned position — empty when the account holds none. Each
 *   entry's `state` is `null` when the public mapping carries no entry for it:
 *   a mint that has not finalized, or a position already burned whose record
 *   the scanner still serves.
 * @throws When the client has no record access, when tick-key derivation
 *   needs the missing `@provablehq/sdk` peer, and on transport errors.
 *
 * @example
 * const positions = await getOwnedPositions(client)
 * for (const p of positions) {
 *   console.log(p.positionTokenId, p.state?.amount0, p.state?.uncollectedFees0)
 * }
 */
export async function getOwnedPositions(
  client: Client,
  params: GetOwnedPositionsParameters = {},
): Promise<GetOwnedPositionsReturnType> {
  const program = params.program ?? SHIELD_SWAP
  const nfts = await listPositionNFTs(client, { program, poolKey: params.poolKey })

  // A burn is proven by two facts together: the `positions` entry is gone AND a
  // record for that token id has been consumed. Neither alone is enough. The
  // entry is absent for an unfinalized mint too, and consumed records are the
  // normal state of a live position, since every liquidity operation spends the
  // PositionNFT and re-issues one under the same token id.
  //
  // Taking both also beats waiting for the record side alone: on a burn the
  // mapping drops the entry as soon as the transaction finalizes, while the
  // scanner marks the record spent on its own schedule — minutes later.
  const spentIds = new Set<string>()
  const spentOnly = new Map<string, PositionNFTInfo>()
  if (params.includeClosed) {
    const held = new Set(nfts.map((nft) => nft.tokenId))
    const spent = await listPositionNFTs(client, {
      program,
      poolKey: params.poolKey,
      statusFilter: 'spent',
    })
    for (const nft of spent) {
      // Verified rather than trusted: a record provider that ignores
      // `statusFilter` answers this scan with unspent records, and taking those
      // as burn evidence would report every unfinalized mint as closed. A
      // provider that reports no status at all is trusted, since the filter is
      // then the only signal there is.
      if (nft.record.spent === false) continue
      spentIds.add(nft.tokenId)
      // Keyed by token id, so an operated-on position collapses to one entry.
      // Which record wins does not matter: a position's range is fixed at mint.
      if (!held.has(nft.tokenId)) spentOnly.set(nft.tokenId, nft)
    }
  }
  const orphans = [...spentOnly.values()]

  // One slot read per pool, shared as an un-awaited promise so it resolves
  // concurrently with every position's own reads.
  const poolKeys = [...new Set([...nfts, ...orphans].map((nft) => nft.poolKey))]
  const slots = new Map(poolKeys.map((key) => [key, getSlot(client, { poolKey: key, program })]))

  const held = (
    await Promise.all(
      nfts.map((nft) => resolveOwnedPosition(client, { nft, program, slot: slots.get(nft.poolKey)! })),
    )
  ).map((position) => ({
    ...position,
    closed: position.state === null && spentIds.has(position.positionTokenId),
  }))
  if (!orphans.length) return held

  // Ids seen only among spent records. A missing entry makes them closed; an
  // entry that is still there makes them a live position whose current record the
  // scanner has not served yet, and those are dropped rather than returned —
  // their `record` is consumed, so handing it back as operable would fail at
  // proving. They reappear as ordinary open positions once the scan catches up.
  const resolvedOrphans = await Promise.all(
    orphans.map((nft) => resolveOwnedPosition(client, { nft, program, slot: slots.get(nft.poolKey)! })),
  )
  return [
    ...held,
    ...resolvedOrphans.filter((position) => position.state === null).map((position) => ({ ...position, closed: true })),
  ]
}
