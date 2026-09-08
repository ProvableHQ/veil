import { findBlockHash, getBlock, type Block, type Client, type Transaction } from '@provablehq/veil-core'
import type { ApiClient } from '../../api/client.js'
import type { components } from '../../api/openapi.js'
import { SHIELD_SWAP } from '../../constants.js'
import { amountsForLiquidity, getSqrtPriceAtTickX128 } from '../../utils/q128.js'
import { getPosition } from './getPosition.js'
import { getSlot } from './getSlot.js'

/**
 * Pool trade row as the `/pools/{key}/trades` endpoint returns it.
 *
 * Extends the generated document type because the published OpenAPI schema
 * lags the deployed indexer: it lists only the identity and pool-wide amounts,
 * while the row also carries the ending price, tick, and leg order that make a
 * fill computable. Prices are Q128 serialized as decimal strings.
 *
 * @property legIndex Execution order of a pool leg within its transaction.
 * @property sqrtPriceAfter Pool square-root price after the trade in Q128, or
 *   `null` for rows the indexer recorded without one.
 * @property tickAfter Active pool tick after the trade, or `null`.
 */
type IndexedPoolTrade = components['schemas']['PoolTradeDoc'] & {
  legIndex: number
  sqrtPriceAfter: string | null
  tickAfter: number | null
}

/** An indexed swap joined with the chain order the indexer does not carry. */
type OrderedSwap = IndexedPoolTrade & {
  blockHeight: number
  transactionIndex: number
  transitionId: string
  transitionIndex: number
}

/** Rows the endpoint returns per page — its maximum. */
const PAGE_SIZE = 100

/**
 * Signals that fill tracking cannot continue for the named positions.
 *
 * Thrown by {@link getPositionFills} and delivered to `onError` by
 * {@link watchPositionFills}, which drops the named positions and keeps
 * tracking the rest: a position does not exist or its range or liquidity
 * changed, or its pool's indexed history no longer overlaps the local cursor
 * or lacks the data a fill needs. Retrying does not help; the caller restarts
 * those positions from a fresh snapshot. Other errors a watch reports are
 * transient and the next poll retries them.
 *
 * @property positionTokenIds The positions this error stops tracking. Every
 *   position in a pool when the failure is the pool's, one when it is the
 *   position's own.
 *
 * @example
 * ```ts
 * const stop = watchPositionFills(client, client.api, {
 *   positionTokenIds,
 *   onFill: (fill) => console.log(fill),
 *   onError: (error) => {
 *     if (error instanceof PositionTrackingError) console.error('stopped', error.positionTokenIds, error.message)
 *   },
 * })
 * ```
 */
export class PositionTrackingError extends Error {
  override readonly name = 'PositionTrackingError'
  readonly positionTokenIds: string[]

  constructor(message: string, options: { positionTokenIds: string[]; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.positionTokenIds = options.positionTokenIds
  }
}

/**
 * Records a liquidity position's inventory before and after one ordered pool
 * swap.
 *
 * The position liquidity and tick range remain fixed during the swap. All
 * square-root prices use Shield Swap's Q128 encoding, and all token amounts use
 * the corresponding token's smallest unit (u128 on chain, `bigint` here).
 *
 * @property tradeId Indexer identifier for the pool trade.
 * @property positionTokenId Token id of the position NFT.
 * @property poolKey Pool key field literal containing the position.
 * @property transactionId Aleo transaction id containing the swap.
 * @property transitionId Aleo transition id that executed the swap.
 * @property blockHeight Block height containing the transaction.
 * @property transactionIndex Transaction order within the block.
 * @property transitionIndex Transition order within the transaction.
 * @property legIndex Pool-leg order within the swap transition.
 * @property positionLiquidity Position liquidity effective during the swap.
 * @property tickLower Lower tick of the position's price range.
 * @property tickUpper Upper tick of the position's price range.
 * @property sqrtPriceBeforeX128 Pool square-root price before the swap in Q128.
 * @property sqrtPriceAfterX128 Pool square-root price after the swap in Q128.
 * @property tickBefore Active pool tick before the swap.
 * @property tickAfter Active pool tick after the swap.
 * @property zeroForOne True when the swap sold token0 for token1.
 * @property amount0Before Token0 backing the position before the swap.
 * @property amount1Before Token1 backing the position before the swap.
 * @property amount0After Token0 backing the position after the swap.
 * @property amount1After Token1 backing the position after the swap.
 */
export type PositionFill = {
  tradeId: string
  positionTokenId: string
  poolKey: string
  transactionId: string
  transitionId: string
  blockHeight: number
  transactionIndex: number
  transitionIndex: number
  legIndex: number
  positionLiquidity: bigint
  tickLower: number
  tickUpper: number
  sqrtPriceBeforeX128: bigint
  sqrtPriceAfterX128: bigint
  tickBefore: number
  tickAfter: number
  zeroForOne: boolean
  amount0Before: bigint
  amount1Before: bigint
  amount0After: bigint
  amount1After: bigint
}

/** The fill context a caller supplies; the inventory amounts are derived. */
export type CalculatePositionFillParameters = Omit<
  PositionFill,
  'amount0Before' | 'amount1Before' | 'amount0After' | 'amount1After'
>

/**
 * Calculates a position's token inventory before and after one pool swap.
 *
 * Concentrated liquidity represents different token amounts at different
 * prices, so a swap that moves the pool price changes what backs a position
 * even though its liquidity is fixed. Values the supplied liquidity and range
 * at both prices with the contract's own rounding. Pure and local.
 *
 * @param params Trade identity, chain order, fixed position state, and the
 *   pool prices on either side of the swap.
 * @returns The supplied context with the four inventory amounts filled in.
 *
 * @example
 * ```ts
 * const fill = calculatePositionFill({
 *   tradeId: 'trade-1',
 *   positionTokenId: '11field',
 *   poolKey: '22field',
 *   transactionId: 'at1...',
 *   transitionId: 'au1...',
 *   blockHeight: 123,
 *   transactionIndex: 4,
 *   transitionIndex: 2,
 *   legIndex: 0,
 *   positionLiquidity: 1_000_000n,
 *   tickLower: -100,
 *   tickUpper: 100,
 *   sqrtPriceBeforeX128: getSqrtPriceAtTickX128(0),
 *   sqrtPriceAfterX128: getSqrtPriceAtTickX128(10),
 *   tickBefore: 0,
 *   tickAfter: 10,
 *   zeroForOne: false,
 * })
 * ```
 */
export function calculatePositionFill(params: CalculatePositionFillParameters): PositionFill {
  const range = {
    liquidity: params.positionLiquidity,
    sqrtLowerX128: getSqrtPriceAtTickX128(params.tickLower),
    sqrtUpperX128: getSqrtPriceAtTickX128(params.tickUpper),
  }
  const before = amountsForLiquidity({ ...range, sqrtPriceX128: params.sqrtPriceBeforeX128 })
  const after = amountsForLiquidity({ ...range, sqrtPriceX128: params.sqrtPriceAfterX128 })
  return {
    ...params,
    amount0Before: before.amount0,
    amount1Before: before.amount1,
    amount0After: after.amount0,
    amount1After: after.amount1,
  }
}

/**
 * Parameters for {@link getPositionFills}.
 *
 * Fills are valued at each position's liquidity as it stands now. A window
 * that reaches back past an increase or decrease reports what the current
 * liquidity would have done over those swaps, not what the position held then.
 *
 * @property positionTokenIds The positions' `token_id` field literals. Positions
 *   in the same pool share its trade pages and block reads, so tracking several
 *   costs little more than tracking one.
 * @property history Number of recent fills to reconstruct per pool. Defaults to
 *   `20` when `fromBlock` is absent. Reads one more swap than this, since the
 *   earliest swap only establishes the starting price; when the pool has fewer
 *   swaps, every available fill is returned. `0` reads the latest swap for its
 *   ending price and returns no fills. Cannot be combined with `fromBlock`.
 * @property fromBlock Reconstruct every fill from this block height onward
 *   instead of a fixed count. The swap before the window supplies the starting
 *   price. The indexer pages by timestamp, so the action resolves one block per
 *   distinct block it reads; a deep window on a busy pool costs many requests.
 *   Cannot be combined with `history`.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetPositionFillsParameters = {
  positionTokenIds: string[]
  history?: number
  fromBlock?: number
  program?: string
}

/**
 * The pool price every fill in a replay is measured from.
 *
 * @property sqrtPriceX128 Pool square-root price in Q128.
 * @property tick Active pool tick at that price.
 * @property tradeId Indexer id of the swap that set the price, or `null` when
 *   the pool had no indexed swap and the live slot supplied it.
 */
export type PositionFillsStart = {
  sqrtPriceX128: bigint
  tick: number
  tradeId: string | null
}

/**
 * A position's fixed state and the price its replay starts from.
 *
 * @property positionTokenId Token id of the position NFT.
 * @property poolKey Pool key field literal the position belongs to.
 * @property tickLower Lower tick of the position's range.
 * @property tickUpper Upper tick of the position's range.
 * @property liquidity Position liquidity the fills were valued at (u128).
 * @property start The price the position's first fill is measured from.
 */
export type PositionFillsSnapshot = {
  positionTokenId: string
  poolKey: string
  tickLower: number
  tickUpper: number
  liquidity: bigint
  start: PositionFillsStart
}

/**
 * The tracked positions and the fills reconstructed against them.
 *
 * @property positions One snapshot per requested position, in request order.
 * @property fills Every fill across all positions in chain order — block,
 *   transaction, transition, then leg — oldest first. Each fill names its
 *   position and pool.
 */
export type GetPositionFillsReturnType = {
  positions: PositionFillsSnapshot[]
  fills: PositionFill[]
}

/** The position facts a fill depends on, held fixed for the tracker's life. */
type PositionSnapshot = Omit<PositionFillsSnapshot, 'start'>

/** Reads the position's pool, range, and liquidity — the fixed inputs to every fill. */
async function snapshotPosition(client: Client, params: { positionTokenId: string; program?: string }): Promise<PositionSnapshot> {
  const position = await getPosition(client, params)
  if (!position) {
    throw new PositionTrackingError(`Position ${params.positionTokenId} does not exist on chain.`, {
      positionTokenIds: [params.positionTokenId],
    })
  }
  return {
    positionTokenId: params.positionTokenId,
    poolKey: position.pool,
    tickLower: position.tick_lower,
    tickUpper: position.tick_upper,
    liquidity: position.liquidity,
  }
}

/** True for the two indexer row kinds that move the pool price. */
const isSwap = (trade: IndexedPoolTrade): boolean =>
  trade.tradeType === 'swap' || trade.tradeType === 'swap_multi_hop'

/** Chain order: block, transaction, transition, then multi-hop leg. */
const byChainOrder = (a: OrderedSwap | PositionFill, b: OrderedSwap | PositionFill): number =>
  a.blockHeight - b.blockHeight ||
  a.transactionIndex - b.transactionIndex ||
  a.transitionIndex - b.transitionIndex ||
  a.legIndex - b.legIndex

/**
 * The positions tracked in one pool and the cursor they share.
 *
 * Every position in a pool is valued against the same ordered swaps, so the
 * pool — not the position — owns the seen set and the running price.
 *
 * @property positions The pool's tracked positions, keyed by token id.
 * @property seen Indexer row ids already accounted for.
 * @property sqrtPrice Pool square-root price the next fill is measured from.
 * @property tick Active tick at that price.
 */
type PoolTracker = {
  poolKey: string
  positions: Map<string, PositionSnapshot>
  seen: Set<string>
  sqrtPrice: bigint
  tick: number
}

/** Ids of every position a pool tracker holds, for error attribution. */
const trackedIds = (pool: Pick<PoolTracker, 'positions'>): string[] => [...pool.positions.keys()]

/** Rejects a swap row the indexer recorded without the price a fill needs. */
function assertComplete(swaps: IndexedPoolTrade[], positionTokenIds: string[], consequence: string): void {
  const incomplete = swaps.find((trade) => trade.sqrtPriceAfter === null || trade.tickAfter === null)
  if (incomplete) {
    throw new PositionTrackingError(
      `Indexed swap ${incomplete.id} has no sqrtPriceAfter or tickAfter; ${consequence}.`,
      { positionTokenIds },
    )
  }
}

/**
 * Resolves each swap against its Aleo block and sorts into execution order.
 *
 * Indexer timestamps do not establish execution order, and consecutive prices
 * are only meaningful in that order. Each transaction is located in its block,
 * then the rows sort by block, transaction, transition, and multi-hop leg.
 * Blocks are cached across calls, since a page of trades usually shares a few.
 */
async function orderSwaps(
  client: Client,
  program: string,
  swaps: IndexedPoolTrade[],
  blocks: Map<string, Block>,
  positionTokenIds: string[],
): Promise<OrderedSwap[]> {
  const ordered = await Promise.all(
    swaps.map(async (trade) => {
      const blockHash = await findBlockHash(client, { transactionId: trade.transactionHash })
      let block = blocks.get(blockHash)
      if (!block) {
        block = await getBlock(client, { hash: blockHash })
        blocks.set(blockHash, block)
      }
      const confirmed = block.transactions?.find(({ transaction }) => transaction.id === trade.transactionHash)
      if (!confirmed) {
        throw new PositionTrackingError(`Transaction ${trade.transactionHash} was not found in block ${blockHash}.`, {
          positionTokenIds,
        })
      }
      const transaction = confirmed.transaction as Transaction
      const transitionIndex =
        transaction.execution?.transitions.findIndex(
          (transition) => transition.program === program && transition.function === trade.tradeType,
        ) ?? -1
      const transition = transaction.execution?.transitions[transitionIndex]
      if (!transition) {
        throw new PositionTrackingError(
          `Transaction ${trade.transactionHash} has no ${program}/${trade.tradeType} transition.`,
          { positionTokenIds },
        )
      }
      return {
        ...trade,
        blockHeight: block.header.metadata.height,
        transactionIndex: confirmed.index,
        transitionId: transition.id,
        transitionIndex,
      }
    }),
  )
  return ordered.sort(byChainOrder)
}

/** What a window read hands back: every row seen, and the swaps to replay in chain order. */
type Window = { rows: IndexedPoolTrade[]; ordered: OrderedSwap[] }

/**
 * Reads the most recent `swapCount` swaps in chain order.
 *
 * Pages newest-first. The endpoint interleaves liquidity operations with
 * swaps, so more rows are read than swaps wanted. Rows sharing the cutoff
 * swap's timestamp are read too: the indexer orders by timestamp, and the
 * chain decides which of several same-second swaps is oldest, so all of them
 * must reach the sort.
 */
async function readRecentSwaps(
  client: Client,
  api: ApiClient,
  program: string,
  pool: Pick<PoolTracker, 'poolKey' | 'positions'>,
  swapCount: number,
  blocks: Map<string, Block>,
): Promise<Window> {
  const rows: IndexedPoolTrade[] = []
  const swaps: IndexedPoolTrade[] = []
  let offset = 0
  while (true) {
    const page = await api.getPoolTrades(pool.poolKey, { limit: PAGE_SIZE, offset })
    const pageRows = page.data as IndexedPoolTrade[]
    rows.push(...pageRows)
    swaps.push(...pageRows.filter(isSwap))
    if (pageRows.length < PAGE_SIZE) break
    const cutoffTime = swaps[swapCount - 1]?.executedAt
    if (cutoffTime !== undefined && pageRows.at(-1)?.executedAt !== cutoffTime) break
    offset += pageRows.length
  }
  const cutoffTime = swaps[swapCount - 1]?.executedAt
  const candidates = swaps.filter((trade, index) => index < swapCount || trade.executedAt === cutoffTime)
  assertComplete(candidates, trackedIds(pool), 'cannot replay history')
  const ordered = (await orderSwaps(client, program, candidates, blocks, trackedIds(pool))).slice(-swapCount)
  return { rows, ordered }
}

/**
 * Reads every swap from `fromBlock` onward, plus the one before it, in chain
 * order.
 *
 * The indexer pages by timestamp, so each page's swaps are resolved to their
 * blocks as they arrive; paging stops once a swap older than the window has
 * been seen and the page's last timestamp has moved past it. The newest
 * pre-window swap leads the result so the first fill inside the window has a
 * real starting price.
 */
async function readSwapsFromBlock(
  client: Client,
  api: ApiClient,
  program: string,
  pool: Pick<PoolTracker, 'poolKey' | 'positions'>,
  fromBlock: number,
  blocks: Map<string, Block>,
): Promise<Window> {
  const rows: IndexedPoolTrade[] = []
  const ordered: OrderedSwap[] = []
  let offset = 0
  while (true) {
    const page = await api.getPoolTrades(pool.poolKey, { limit: PAGE_SIZE, offset })
    const pageRows = page.data as IndexedPoolTrade[]
    rows.push(...pageRows)
    // Every swap on the page is resolved to its block, since block heights are
    // what decide where the window starts. Completeness is checked later, on
    // the swaps actually kept: a legacy row without a price beyond the window
    // must not fail a replay that never uses it.
    ordered.push(...(await orderSwaps(client, program, pageRows.filter(isSwap), blocks, trackedIds(pool))))
    if (pageRows.length < PAGE_SIZE) break
    // Same-second rows can straddle a page boundary, so the read continues while
    // the page ends on the timestamp of a swap that has already left the window.
    const before = ordered.filter((swap) => swap.blockHeight < fromBlock)
    const newestBefore = before.reduce<OrderedSwap | undefined>(
      (newest, swap) => (!newest || byChainOrder(swap, newest) > 0 ? swap : newest),
      undefined,
    )
    if (newestBefore && pageRows.at(-1)?.executedAt !== newestBefore.executedAt) break
    offset += pageRows.length
  }
  ordered.sort(byChainOrder)
  const firstInWindow = ordered.findIndex((swap) => swap.blockHeight >= fromBlock)
  // Keep the newest pre-window swap as the price seed; drop the rest.
  const seedIndex = firstInWindow === -1 ? ordered.length - 1 : firstInWindow - 1
  const kept = ordered.slice(Math.max(0, seedIndex))
  assertComplete(kept, trackedIds(pool), 'cannot replay history')
  return { rows, ordered: kept }
}

/**
 * Turns ordered swaps into fills for every position in the pool, advancing the
 * shared cursor through each swap.
 *
 * @throws {PositionTrackingError} When a swap did not move the price — its
 *   direction is then undeterminable and the cursor cannot safely advance.
 */
function recordFills(pool: PoolTracker, swaps: OrderedSwap[]): PositionFill[] {
  const fills: PositionFill[] = []
  for (const trade of swaps) {
    const sqrtPriceAfter = BigInt(trade.sqrtPriceAfter!)
    if (sqrtPriceAfter === pool.sqrtPrice) {
      throw new PositionTrackingError(
        `Indexed swap ${trade.id} did not move the pool price; cannot determine its direction.`,
        { positionTokenIds: trackedIds(pool) },
      )
    }
    for (const position of pool.positions.values()) {
      fills.push(
        calculatePositionFill({
          tradeId: trade.id,
          positionTokenId: position.positionTokenId,
          poolKey: pool.poolKey,
          transactionId: trade.transactionHash,
          transitionId: trade.transitionId,
          blockHeight: trade.blockHeight,
          transactionIndex: trade.transactionIndex,
          transitionIndex: trade.transitionIndex,
          legIndex: trade.legIndex,
          positionLiquidity: position.liquidity,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          sqrtPriceBeforeX128: pool.sqrtPrice,
          sqrtPriceAfterX128: sqrtPriceAfter,
          tickBefore: pool.tick,
          tickAfter: trade.tickAfter!,
          zeroForOne: sqrtPriceAfter < pool.sqrtPrice,
        }),
      )
    }
    pool.sqrtPrice = sqrtPriceAfter
    pool.tick = trade.tickAfter!
  }
  return fills
}

/** Validates the window selection shared by the one-shot read and the watch. */
function validateWindow(params: { history?: number; fromBlock?: number }): void {
  if (params.history !== undefined && params.fromBlock !== undefined) {
    throw new Error('history and fromBlock select the window two different ways; pass one of them.')
  }
  if (params.history !== undefined && (!Number.isInteger(params.history) || params.history < 0)) {
    throw new Error('history must be a non-negative integer.')
  }
  if (params.fromBlock !== undefined && (!Number.isInteger(params.fromBlock) || params.fromBlock < 0)) {
    throw new Error('fromBlock must be a non-negative block height.')
  }
}

/** Groups position snapshots by pool into trackers with no cursor yet. */
function groupByPool(positions: PositionSnapshot[]): Map<string, PositionSnapshot[]> {
  const pools = new Map<string, PositionSnapshot[]>()
  for (const position of positions) {
    pools.set(position.poolKey, [...(pools.get(position.poolKey) ?? []), position])
  }
  return pools
}

/**
 * Replays one pool's window and leaves its tracker positioned after it.
 *
 * Shared by the one-shot read and the watch, so a watch's live fills continue
 * exactly where its replay stopped with no window for a swap to fall between.
 */
async function replayPool(
  client: Client,
  api: ApiClient,
  params: { history?: number; fromBlock?: number; program: string },
  poolKey: string,
  positions: PositionSnapshot[],
  blocks: Map<string, Block>,
): Promise<{ pool: PoolTracker; start: PositionFillsStart; fills: PositionFill[] }> {
  const pending = { poolKey, positions: new Map(positions.map((position) => [position.positionTokenId, position])) }
  const window =
    params.fromBlock !== undefined
      ? await readSwapsFromBlock(client, api, params.program, pending, params.fromBlock, blocks)
      : // One more swap than fills: the earliest only establishes the starting price.
        await readRecentSwaps(client, api, params.program, pending, (params.history ?? 20) + 1, blocks)

  // Fall back to the live slot only when the pool has no indexed swap at all.
  const first = window.ordered[0]
  const slot = first ? null : await getSlot(client, { poolKey, program: params.program })
  if (!first && !slot) {
    throw new PositionTrackingError(`Pool ${poolKey} has neither a slot nor indexed swaps.`, {
      positionTokenIds: trackedIds(pending),
    })
  }
  const pool: PoolTracker = {
    ...pending,
    seen: new Set(window.rows.map((trade) => trade.id)),
    sqrtPrice: first ? BigInt(first.sqrtPriceAfter!) : slot!.sqrt_price,
    tick: first ? first.tickAfter! : slot!.tick,
  }
  const start: PositionFillsStart = { sqrtPriceX128: pool.sqrtPrice, tick: pool.tick, tradeId: first?.id ?? null }
  return { pool, start, fills: recordFills(pool, window.ordered.slice(1)) }
}

/**
 * Reads pages newest-first until a known row appears and returns the fills for
 * every swap in between, advancing the pool's cursor.
 *
 * The overlap with the seen set is what makes the read safe when more than one
 * page lands between polls. Liquidity rows are marked seen but produce no fill.
 * Positions whose range or liquidity changed are dropped from the tracker and
 * returned, so the caller can report them; the remaining positions' fills are
 * still produced.
 */
async function backfillPool(
  client: Client,
  api: ApiClient,
  params: { program: string },
  pool: PoolTracker,
  blocks: Map<string, Block>,
): Promise<{ fills: PositionFill[]; changed: string[] }> {
  const unseen: IndexedPoolTrade[] = []
  let offset = 0
  while (true) {
    const page = await api.getPoolTrades(pool.poolKey, { limit: PAGE_SIZE, offset })
    const rows = page.data as IndexedPoolTrade[]
    unseen.push(...rows.filter((trade) => !pool.seen.has(trade.id)))
    if (rows.some((trade) => pool.seen.has(trade.id))) break
    if (rows.length < PAGE_SIZE) {
      // An empty seen set means the pool had no history to overlap with.
      if (pool.seen.size === 0) break
      throw new PositionTrackingError(
        `Indexed history for pool ${pool.poolKey} no longer overlaps the local cursor; restart from a fresh snapshot.`,
        { positionTokenIds: trackedIds(pool) },
      )
    }
    offset += rows.length
  }
  if (!unseen.length) return { fills: [], changed: [] }

  // Pool rows cannot say which position a liquidity operation touched, so a
  // changed range or liquidity cannot be attributed to a point in the swap
  // sequence. Drop such a position rather than value swaps against the wrong
  // liquidity; the others in the pool are unaffected.
  const changed: string[] = []
  await Promise.all(
    [...pool.positions.values()].map(async (position) => {
      const current = await getPosition(client, { positionTokenId: position.positionTokenId, program: params.program })
      if (
        !current ||
        current.pool !== position.poolKey ||
        current.tick_lower !== position.tickLower ||
        current.tick_upper !== position.tickUpper ||
        current.liquidity !== position.liquidity
      ) {
        changed.push(position.positionTokenId)
      }
    }),
  )
  for (const id of changed) pool.positions.delete(id)

  const swaps = unseen.filter(isSwap)
  assertComplete(swaps, trackedIds(pool), 'refusing to advance the cursor')
  const fills = recordFills(pool, await orderSwaps(client, params.program, swaps, blocks, trackedIds(pool)))
  for (const trade of unseen) pool.seen.add(trade.id)
  return { fills, changed }
}

/** Rejects an empty request and collapses repeated ids, keeping first-seen order. */
function uniquePositionIds(positionTokenIds: string[]): string[] {
  const unique = [...new Set(positionTokenIds)]
  if (!unique.length) throw new Error('positionTokenIds must name at least one position.')
  return unique
}

/**
 * Reconstructs recent swap fills for one or more liquidity positions.
 *
 * A fill is the change in token0 and token1 backing a position's fixed
 * liquidity between two consecutive pool prices. The position mapping supplies
 * each position's pool, range, and liquidity; the DEX API's pool trade history
 * supplies each swap's ending price; and Aleo blocks supply the execution
 * order the indexer's timestamps do not. Positions in the same pool are valued
 * against one read of that pool's history. Fills describe inventory, not
 * accrued fees — `getOwnedPosition` reports what `collect` would pay.
 *
 * Hits the network: one `positions` read per position, one or more
 * authenticated pool-trade pages per pool, and one block lookup per distinct
 * block among the replayed swaps. The API client must already hold a session
 * (`authenticateShieldSwap`) or an API token. Applies to a one-off report; a
 * live feed wants {@link watchPositionFills}.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param api An authenticated DEX API client for the same network.
 * @param params The positions, the window (`history` or `fromBlock`), and the
 *   program.
 * @returns One snapshot per position and every fill in chain order across all
 *   of them. `fills` is empty when no pool has more than one indexed swap in
 *   the window.
 * @throws {PositionTrackingError} When a position does not exist, an indexed
 *   swap lacks its ending price or did not move the price, a transaction cannot
 *   be located in its block, or a pool has neither swaps nor a slot. The error
 *   names the positions it concerns.
 * @throws When `positionTokenIds` is empty, `history` or `fromBlock` is not a
 *   non-negative integer, both are passed, and on transport or API errors.
 *
 * @example
 * ```ts
 * const { fills } = await client.getPositionFills({ positionTokenIds: [positionA, positionB], history: 50 })
 * for (const fill of fills) {
 *   console.log(fill.positionTokenId, fill.blockHeight, fill.amount0After - fill.amount0Before)
 * }
 *
 * // Everything since a block height instead of a count.
 * await client.getPositionFills({ positionTokenIds: [positionA], fromBlock: 19_400_000 })
 * ```
 */
export async function getPositionFills(
  client: Client,
  api: ApiClient,
  params: GetPositionFillsParameters,
): Promise<GetPositionFillsReturnType> {
  validateWindow(params)
  const program = params.program ?? SHIELD_SWAP
  const ids = uniquePositionIds(params.positionTokenIds)
  const snapshots = await Promise.all(ids.map((positionTokenId) => snapshotPosition(client, { positionTokenId, program })))

  // Pools share nothing but the block cache, so they replay concurrently.
  const blocks = new Map<string, Block>()
  const replays = await Promise.all(
    [...groupByPool(snapshots)].map(([poolKey, positions]) =>
      replayPool(client, api, { ...params, program }, poolKey, positions, blocks),
    ),
  )
  const startOf = new Map(replays.map(({ pool, start }) => [pool.poolKey, start]))
  return {
    positions: snapshots.map((position) => ({ ...position, start: startOf.get(position.poolKey)! })),
    fills: replays.flatMap(({ fills }) => fills).sort(byChainOrder),
  }
}

/**
 * Parameters for {@link watchPositionFills}.
 *
 * @property positionTokenIds The positions' `token_id` field literals. Positions
 *   in the same pool share one cursor and one trade-room subscription.
 * @property onFill Receives each fill in execution order within its pool:
 *   first those the replay reconstructed (`replayed: true`), then live ones as
 *   the indexer records them. Pools replay and poll independently, so fills
 *   from different pools interleave by arrival rather than by block.
 * @property onError Receives every failure. A {@link PositionTrackingError}
 *   means the positions it names are no longer tracked; the watch stops itself
 *   once none remain. Anything else is transient and the next poll retries.
 *   Defaults to ignoring errors.
 * @property history Fills to reconstruct per pool before going live. Defaults
 *   to `20` when `fromBlock` is absent; `0` starts from the latest swap's
 *   ending price without replaying.
 * @property fromBlock Replay every fill from this block height onward before
 *   going live. Cannot be combined with `history`.
 * @property pollingInterval Milliseconds between REST backfills. Defaults to
 *   `10_000`. The poll is the source of truth; WebSocket messages only bring a
 *   backfill forward.
 * @property webSocketUrl Shield Swap WebSocket endpoint. Defaults to the
 *   endpoint matching the API client's host. `false` disables the socket and
 *   relies on polling alone, which is also what happens on a runtime without a
 *   global `WebSocket`.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type WatchPositionFillsParameters = {
  positionTokenIds: string[]
  onFill: (fill: PositionFill, context: { replayed: boolean }) => void
  onError?: (error: Error) => void
  history?: number
  fromBlock?: number
  pollingInterval?: number
  webSocketUrl?: string | false
  program?: string
}

/** Stops the watch: closes the socket, clears the timers, drops in-flight results. */
export type WatchPositionFillsReturnType = () => void

/** Shield Swap WebSocket endpoints, matching the DEX API hosts. */
const WS_URLS = {
  mainnet: 'wss://ws.swap.shield.fi/ws',
  testnet: 'wss://ws.testnet.swap.shield.fi/ws',
} as const

/** WebSocket tickets are short-lived; re-authenticate well inside their life. */
const TICKET_RENEWAL_MS = 45_000

/**
 * Streams fills for one or more liquidity positions as swaps land in their
 * pools.
 *
 * Replays each pool's window exactly as {@link getPositionFills} does, then
 * keeps every pool's cursor moving: each `pollingInterval` it reads new pool
 * trades back to the last one it saw, orders them against their blocks, and
 * emits one fill per swap per position in that pool. When a WebSocket is
 * available it subscribes to each pool's trade room and treats a message as a
 * signal to poll now rather than as ordered data, so a dropped socket degrades
 * to polling instead of losing fills.
 *
 * Each position's range and liquidity are held fixed. When a poll finds one
 * changed, the watch reports a {@link PositionTrackingError} naming it and
 * drops it, since pool rows cannot say which swaps happened at the old
 * liquidity; the other positions continue. A pool-level failure drops every
 * position in that pool. The watch stops itself when no positions remain.
 *
 * Hits the network continuously and opens a WebSocket; signs nothing. The API
 * client must already hold a session or API token.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param api An authenticated DEX API client for the same network.
 * @param params The positions, callbacks, replay window, and transport knobs.
 * @returns A function that stops the watch. Safe to call more than once.
 * @throws When `positionTokenIds` is empty, `history` or `fromBlock` is not a
 *   non-negative integer, or both are passed. Every later failure reaches
 *   `onError` instead.
 *
 * @example
 * ```ts
 * const stop = client.watchPositionFills({
 *   positionTokenIds: [positionA, positionB],
 *   onFill: (fill, { replayed }) => console.log(replayed ? 'replayed' : 'live', fill.positionTokenId, fill.tradeId),
 *   onError: (error) => console.error(error),
 * })
 * // later
 * stop()
 * ```
 */
export function watchPositionFills(
  client: Client,
  api: ApiClient,
  params: WatchPositionFillsParameters,
): WatchPositionFillsReturnType {
  validateWindow(params)
  const program = params.program ?? SHIELD_SWAP
  const ids = uniquePositionIds(params.positionTokenIds)
  const pollingInterval = params.pollingInterval ?? 10_000
  const onError = params.onError ?? (() => {})
  const blocks = new Map<string, Block>()

  let stopped = false
  let poll: ReturnType<typeof setInterval> | undefined
  let renewal: ReturnType<typeof setInterval> | undefined
  let socket: WebSocket | undefined

  const stop = () => {
    stopped = true
    if (poll) clearInterval(poll)
    if (renewal) clearInterval(renewal)
    socket?.close()
  }

  // Live pools, keyed by pool key. A pool leaves the map when its last
  // position is dropped; the watch stops when the map empties.
  const pools = new Map<string, PoolTracker>()
  const dropPositions = (error: PositionTrackingError) => {
    onError(error)
    for (const pool of pools.values()) {
      for (const id of error.positionTokenIds) pool.positions.delete(id)
      if (!pool.positions.size) pools.delete(pool.poolKey)
    }
  }

  // Backfills run one at a time per pool: each advances the pool's cursor, and
  // two in flight would both read the same unseen rows and emit every fill
  // twice. Pools are independent, so each has its own queue.
  const queues = new Map<string, Promise<void>>()
  const enqueue = (poolKey: string, run: () => Promise<void>) => {
    const queued = (queues.get(poolKey) ?? Promise.resolve()).then(async () => {
      if (stopped) return
      try {
        await run()
      } catch (error) {
        if (stopped) return
        if (error instanceof PositionTrackingError) dropPositions(error)
        else onError(error as Error)
      }
      if (!pools.size && ready) stop()
    })
    queues.set(poolKey, queued)
    return queued
  }

  // The replay establishes each pool's tracker. A position that cannot be
  // snapshotted is dropped before grouping; a pool whose replay fails is dropped
  // whole. Only after every pool has been tried can "no pools left" mean stop.
  let ready = false
  const replayed = (async () => {
    const snapshots = (
      await Promise.all(
        ids.map((positionTokenId) =>
          snapshotPosition(client, { positionTokenId, program }).catch((error: unknown) => {
            if (stopped) return undefined
            onError(
              error instanceof PositionTrackingError
                ? error
                : new PositionTrackingError(`Position ${positionTokenId} could not be read: ${(error as Error).message}`, {
                    positionTokenIds: [positionTokenId],
                    cause: error,
                  }),
            )
            return undefined
          }),
        ),
      )
    ).filter((snapshot): snapshot is PositionSnapshot => snapshot !== undefined)

    await Promise.all(
      [...groupByPool(snapshots)].map(([poolKey, positions]) =>
        enqueue(poolKey, async () => {
          try {
            const { pool, fills } = await replayPool(client, api, { ...params, program }, poolKey, positions, blocks)
            if (stopped) return
            pools.set(poolKey, pool)
            for (const fill of fills) params.onFill(fill, { replayed: true })
          } catch (error) {
            throw error instanceof PositionTrackingError
              ? error
              : new PositionTrackingError(`Fill replay for pool ${poolKey} failed: ${(error as Error).message}`, {
                  positionTokenIds: positions.map((position) => position.positionTokenId),
                  cause: error,
                })
          }
        }),
      ),
    )
    ready = true
    if (!pools.size) stop()
  })()

  const live = () => {
    for (const pool of pools.values()) {
      void enqueue(pool.poolKey, async () => {
        const { fills, changed } = await backfillPool(client, api, { program }, pool, blocks)
        if (stopped) return
        if (changed.length) {
          dropPositions(
            new PositionTrackingError(
              `Position${changed.length > 1 ? 's' : ''} ${changed.join(', ')} changed; restart from a fresh snapshot.`,
              { positionTokenIds: changed },
            ),
          )
        }
        for (const fill of fills) params.onFill(fill, { replayed: false })
      })
    }
  }
  poll = setInterval(live, pollingInterval)

  // The socket only brings the next poll forward. Authentication frames carry a
  // ticket minted per connection; a ticket the socket rejects, or a socket that
  // never opens, costs nothing because the poll is still running.
  const wsUrl =
    params.webSocketUrl === undefined
      ? api.baseUrl.includes('testnet')
        ? WS_URLS.testnet
        : WS_URLS.mainnet
      : params.webSocketUrl
  if (wsUrl !== false && typeof WebSocket !== 'undefined') {
    void api
      .getWebSocketTicket()
      .then(({ token }) => {
        if (stopped) return
        socket = new WebSocket(wsUrl)
        socket.addEventListener('open', () => {
          socket!.send(JSON.stringify({ action: 'authenticate', token }))
          // The rooms are known only once the replay has resolved each pool, so
          // subscribing waits on it rather than on `open` alone.
          void replayed.then(() => {
            if (stopped) return
            for (const poolKey of pools.keys()) {
              socket!.send(JSON.stringify({ action: 'subscribe', room: `trades:${poolKey}` }))
            }
            socket!.send(JSON.stringify({ action: 'synchronize' }))
          })
          renewal = setInterval(() => {
            void api
              .getWebSocketTicket()
              .then((ticket) => socket?.send(JSON.stringify({ action: 'authenticate', token: ticket.token })))
              .catch((error: unknown) => onError(error as Error))
          }, TICKET_RENEWAL_MS)
        })
        socket.addEventListener('message', ({ data }) => {
          try {
            const message = JSON.parse(String(data)) as { type?: string; control?: string }
            if (message.type === 'Trade' || message.control === 'synchronized' || message.control === 'resync_required') {
              live()
            }
          } catch {
            // Unknown frames do not move the cursor; the poll remains authoritative.
          }
        })
        socket.addEventListener('close', () => {
          if (renewal) clearInterval(renewal)
        })
      })
      .catch((error: unknown) => onError(error as Error))
  }

  return stop
}
