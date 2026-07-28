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
 * @property state The joined and derived chain state, or `null` while a
 *   fresh mint has not finalized into the `positions` mapping yet.
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
  state: OwnedPositionState | null
}

/**
 * Parameters for {@link getOwnedPositions}.
 *
 * @property poolKey Restricts the listing to one pool's positions. Optional —
 *   without it, every owned position is returned.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetOwnedPositionsParameters = {
  poolKey?: string
  program?: string
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
export async function enrichOwnedPosition(
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
  }
  // No positions entry yet (finalize lag) — the record side alone.
  if (!position || !slot) return { ...base, state: null }

  const { amount0, amount1 } = amountsForLiquidity(
    slot.sqrt_price,
    getSqrtPriceAtTickX128(nft.tickLower),
    getSqrtPriceAtTickX128(nft.tickUpper),
    position.liquidity,
  )
  // An uninitialized boundary tick reads as zero outside-growth; that state
  // is only reachable at zero liquidity, where the fee delta multiplies out.
  const owedSince = (outsideLower: bigint, outsideUpper: bigint, global: bigint, last: bigint) =>
    feeOwed(
      feeGrowthInside({
        tickCurrent: slot.tick,
        tickLower: nft.tickLower,
        tickUpper: nft.tickUpper,
        feeGrowthOutsideLowerX128: outsideLower,
        feeGrowthOutsideUpperX128: outsideUpper,
        feeGrowthGlobalX128: global,
      }),
      last,
      position.liquidity,
    )

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
 * @param client A Veil wallet client with record access.
 * @param params Optional pool filter and program override.
 * @returns Every owned position — empty when the account holds none. Each
 *   entry's `state` is `null` while its mint has not finalized on chain.
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

  // One slot read per pool, shared as an un-awaited promise so it resolves
  // concurrently with every position's own reads.
  const poolKeys = [...new Set(nfts.map((nft) => nft.poolKey))]
  const slots = new Map(poolKeys.map((key) => [key, getSlot(client, { poolKey: key, program })]))

  return Promise.all(nfts.map((nft) => enrichOwnedPosition(client, { nft, program, slot: slots.get(nft.poolKey)! })))
}
