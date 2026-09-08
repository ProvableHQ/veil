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
 * Signals that fill tracking cannot continue from its current cursor.
 *
 * Thrown by {@link getPositionFills} and delivered to `onError` by
 * {@link watchPositionFills}, which stops itself when it raises one: the
 * position's range or liquidity changed, indexed history no longer overlaps the
 * local cursor, or an indexed swap lacks the data a fill needs. Retrying does
 * not help; the caller restarts from a fresh snapshot. Other errors a watch
 * reports are transient and the next poll retries them.
 *
 * @example
 * ```ts
 * const stop = watchPositionFills(client, client.api, {
 *   positionTokenId,
 *   onFill: (fill) => console.log(fill),
 *   onError: (error) => {
 *     if (error instanceof PositionTrackingError) console.error('stopped:', error.message)
 *   },
 * })
 * ```
 */
export class PositionTrackingError extends Error {
  override readonly name = 'PositionTrackingError'
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
 * @property positionTokenId The position's `token_id` field literal.
 * @property history Number of recent fills to reconstruct. Defaults to `20`.
 *   Reads one more swap than this, since the earliest swap only establishes
 *   the starting price; when the pool has fewer swaps, every available fill
 *   is returned. `0` reads the latest swap for its ending price and returns
 *   no fills.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetPositionFillsParameters = {
  positionTokenId: string
  history?: number
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
 * A position's fixed state and the fills reconstructed against it.
 *
 * @property positionTokenId Token id of the position NFT.
 * @property poolKey Pool key field literal the position belongs to.
 * @property tickLower Lower tick of the position's range.
 * @property tickUpper Upper tick of the position's range.
 * @property liquidity Position liquidity the fills were valued at (u128).
 * @property start The price the first fill is measured from.
 * @property fills The reconstructed fills, oldest first.
 */
export type GetPositionFillsReturnType = {
  positionTokenId: string
  poolKey: string
  tickLower: number
  tickUpper: number
  liquidity: bigint
  start: PositionFillsStart
  fills: PositionFill[]
}

/** The position facts a fill depends on, held fixed for the tracker's life. */
type PositionSnapshot = Pick<GetPositionFillsReturnType, 'positionTokenId' | 'poolKey' | 'tickLower' | 'tickUpper' | 'liquidity'>

/** Reads the position's pool, range, and liquidity — the fixed inputs to every fill. */
async function snapshotPosition(client: Client, params: { positionTokenId: string; program?: string }): Promise<PositionSnapshot> {
  const position = await getPosition(client, params)
  if (!position) {
    throw new PositionTrackingError(`Position ${params.positionTokenId} does not exist on chain.`)
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

/** Rejects a swap row the indexer recorded without the price a fill needs. */
function assertComplete(swaps: IndexedPoolTrade[], consequence: string): void {
  const incomplete = swaps.find((trade) => trade.sqrtPriceAfter === null || trade.tickAfter === null)
  if (incomplete) {
    throw new PositionTrackingError(
      `Indexed swap ${incomplete.id} has no sqrtPriceAfter or tickAfter; ${consequence}.`,
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
        throw new PositionTrackingError(`Transaction ${trade.transactionHash} was not found in block ${blockHash}.`)
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
  return ordered.sort(
    (a, b) =>
      a.blockHeight - b.blockHeight ||
      a.transactionIndex - b.transactionIndex ||
      a.transitionIndex - b.transitionIndex ||
      a.legIndex - b.legIndex,
  )
}

/**
 * Reads pool trades newest-first until `swapCount` swaps are in hand.
 *
 * The endpoint interleaves liquidity operations with swaps, so more rows are
 * read than swaps wanted. Rows sharing the cutoff swap's timestamp are read
 * too: the indexer orders by timestamp, and the chain decides which of several
 * same-second swaps is oldest, so all of them must reach the sort.
 *
 * @returns Every row read (the seen-set baseline) and the swaps among them.
 */
async function readRecentSwaps(
  api: ApiClient,
  poolKey: string,
  swapCount: number,
): Promise<{ rows: IndexedPoolTrade[]; swaps: IndexedPoolTrade[] }> {
  const rows: IndexedPoolTrade[] = []
  const swaps: IndexedPoolTrade[] = []
  let offset = 0
  while (true) {
    const page = await api.getPoolTrades(poolKey, { limit: PAGE_SIZE, offset })
    const pageRows = page.data as IndexedPoolTrade[]
    rows.push(...pageRows)
    swaps.push(...pageRows.filter(isSwap))
    if (pageRows.length < PAGE_SIZE) break
    const cutoffTime = swaps[swapCount - 1]?.executedAt
    if (cutoffTime !== undefined && pageRows.at(-1)?.executedAt !== cutoffTime) break
    offset += pageRows.length
  }
  return { rows, swaps }
}

/**
 * The mutable state a replay hands to the live watch: which indexer rows have
 * been accounted for, and the pool price the next fill is measured from.
 */
type FillCursor = {
  seen: Set<string>
  sqrtPrice: bigint
  tick: number
}

/**
 * Turns ordered swaps into fills, advancing the cursor through each one.
 *
 * @throws {PositionTrackingError} When a swap did not move the price — its
 *   direction is then undeterminable and the cursor cannot safely advance.
 */
function recordFills(position: PositionSnapshot, cursor: FillCursor, swaps: OrderedSwap[]): PositionFill[] {
  return swaps.map((trade) => {
    const sqrtPriceAfter = BigInt(trade.sqrtPriceAfter!)
    if (sqrtPriceAfter === cursor.sqrtPrice) {
      throw new PositionTrackingError(
        `Indexed swap ${trade.id} did not move the pool price; cannot determine its direction.`,
      )
    }
    const fill = calculatePositionFill({
      tradeId: trade.id,
      positionTokenId: position.positionTokenId,
      poolKey: position.poolKey,
      transactionId: trade.transactionHash,
      transitionId: trade.transitionId,
      blockHeight: trade.blockHeight,
      transactionIndex: trade.transactionIndex,
      transitionIndex: trade.transitionIndex,
      legIndex: trade.legIndex,
      positionLiquidity: position.liquidity,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      sqrtPriceBeforeX128: cursor.sqrtPrice,
      sqrtPriceAfterX128: sqrtPriceAfter,
      tickBefore: cursor.tick,
      tickAfter: trade.tickAfter!,
      zeroForOne: sqrtPriceAfter < cursor.sqrtPrice,
    })
    cursor.sqrtPrice = sqrtPriceAfter
    cursor.tick = trade.tickAfter!
    return fill
  })
}

/**
 * Reconstructs the most recent fills and leaves a cursor positioned after them.
 *
 * Shared by the one-shot read and the watch, so a watch's live fills continue
 * exactly where its replay stopped with no window for a swap to fall between.
 */
async function replay(
  client: Client,
  api: ApiClient,
  params: GetPositionFillsParameters & { program: string },
  blocks: Map<string, Block>,
): Promise<{ result: GetPositionFillsReturnType; cursor: FillCursor }> {
  const history = params.history ?? 20
  if (!Number.isInteger(history) || history < 0) {
    throw new Error('history must be a non-negative integer.')
  }
  const position = await snapshotPosition(client, params)

  // One more swap than fills: the earliest only establishes the starting price.
  const swapCount = history + 1
  const { rows, swaps } = await readRecentSwaps(api, position.poolKey, swapCount)
  const cutoffTime = swaps[swapCount - 1]?.executedAt
  const candidates = swaps.filter((trade, index) => index < swapCount || trade.executedAt === cutoffTime)
  assertComplete(candidates, 'cannot replay history')
  const ordered = (await orderSwaps(client, params.program, candidates, blocks)).slice(-swapCount)

  // Fall back to the live slot only when the pool has no indexed swap at all.
  const first = ordered[0]
  const slot = first ? null : await getSlot(client, { poolKey: position.poolKey, program: params.program })
  if (!first && !slot) {
    throw new PositionTrackingError(`Pool ${position.poolKey} has neither a slot nor indexed swaps.`)
  }
  const cursor: FillCursor = {
    seen: new Set(rows.map((trade) => trade.id)),
    sqrtPrice: first ? BigInt(first.sqrtPriceAfter!) : slot!.sqrt_price,
    tick: first ? first.tickAfter! : slot!.tick,
  }
  const start: PositionFillsStart = { sqrtPriceX128: cursor.sqrtPrice, tick: cursor.tick, tradeId: first?.id ?? null }
  const fills = recordFills(position, cursor, ordered.slice(1))
  return { result: { ...position, start, fills }, cursor }
}

/**
 * Reads pages newest-first until a known row appears and returns the fills for
 * every swap in between, advancing the cursor.
 *
 * The overlap with the seen set is what makes the read safe when more than one
 * page lands between polls. Liquidity rows are marked seen but produce no fill.
 */
async function backfill(
  client: Client,
  api: ApiClient,
  params: { program: string },
  position: PositionSnapshot,
  cursor: FillCursor,
  blocks: Map<string, Block>,
): Promise<PositionFill[]> {
  const unseen: IndexedPoolTrade[] = []
  let offset = 0
  while (true) {
    const page = await api.getPoolTrades(position.poolKey, { limit: PAGE_SIZE, offset })
    const rows = page.data as IndexedPoolTrade[]
    unseen.push(...rows.filter((trade) => !cursor.seen.has(trade.id)))
    if (rows.some((trade) => cursor.seen.has(trade.id))) break
    if (rows.length < PAGE_SIZE) {
      // An empty seen set means the pool had no history to overlap with.
      if (cursor.seen.size === 0) break
      throw new PositionTrackingError(
        'Indexed history no longer overlaps the local cursor; restart from a fresh snapshot.',
      )
    }
    offset += rows.length
  }
  if (!unseen.length) return []

  // Pool rows cannot say which position a liquidity operation touched, so a
  // changed range or liquidity cannot be attributed to a point in the swap
  // sequence. Stop rather than value swaps against the wrong liquidity.
  const current = await getPosition(client, { positionTokenId: position.positionTokenId, program: params.program })
  if (
    !current ||
    current.pool !== position.poolKey ||
    current.tick_lower !== position.tickLower ||
    current.tick_upper !== position.tickUpper ||
    current.liquidity !== position.liquidity
  ) {
    throw new PositionTrackingError('The tracked position changed; restart from a fresh snapshot.')
  }

  const swaps = unseen.filter(isSwap)
  assertComplete(swaps, 'refusing to advance the cursor')
  const fills = recordFills(position, cursor, await orderSwaps(client, params.program, swaps, blocks))
  for (const trade of unseen) cursor.seen.add(trade.id)
  return fills
}

/**
 * Reconstructs a liquidity position's recent swap fills.
 *
 * A fill is the change in token0 and token1 backing the position's fixed
 * liquidity between two consecutive pool prices. The position mapping supplies
 * the pool, range, and liquidity; the DEX API's pool trade history supplies
 * each swap's ending price; and Aleo blocks supply the execution order the
 * indexer's timestamps do not. Fills describe inventory, not accrued fees —
 * `getOwnedPosition` reports what `collect` would pay.
 *
 * Hits the network: one `positions` read, one or more authenticated pool-trade
 * pages, and one block lookup per distinct block among the replayed swaps. The
 * API client must already hold a session (`authenticateShieldSwap`) or an API
 * token. Applies to a one-off report; a live feed wants
 * {@link watchPositionFills}.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param api An authenticated DEX API client for the same network.
 * @param params The position, how many fills to reconstruct, and the program.
 * @returns The position's fixed state, the starting price, and the fills
 *   oldest first. `fills` is empty when the pool has at most one indexed swap.
 * @throws {PositionTrackingError} When the position does not exist, an indexed
 *   swap lacks its ending price or did not move the price, a transaction cannot
 *   be located in its block, or the pool has neither swaps nor a slot.
 * @throws When `history` is not a non-negative integer, and on transport or
 *   API errors.
 *
 * @example
 * ```ts
 * const { fills } = await client.getPositionFills({ positionTokenId, history: 50 })
 * for (const fill of fills) {
 *   console.log(fill.blockHeight, fill.amount0After - fill.amount0Before, fill.amount1After - fill.amount1Before)
 * }
 * ```
 */
export async function getPositionFills(
  client: Client,
  api: ApiClient,
  params: GetPositionFillsParameters,
): Promise<GetPositionFillsReturnType> {
  const { result } = await replay(client, api, { ...params, program: params.program ?? SHIELD_SWAP }, new Map())
  return result
}

/**
 * Parameters for {@link watchPositionFills}.
 *
 * @property positionTokenId The position's `token_id` field literal.
 * @property onFill Receives each fill in execution order: first those the
 *   replay reconstructed (`replayed: true`), then live ones as the indexer
 *   records them.
 * @property onError Receives every failure. A {@link PositionTrackingError}
 *   means the watch has stopped itself; anything else is transient and the
 *   next poll retries. Defaults to ignoring errors.
 * @property history Fills to reconstruct before going live. Defaults to `20`;
 *   `0` starts from the latest swap's ending price without replaying.
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
  positionTokenId: string
  onFill: (fill: PositionFill, context: { replayed: boolean }) => void
  onError?: (error: Error) => void
  history?: number
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
 * Streams a liquidity position's fills as swaps land in its pool.
 *
 * Replays recent fills exactly as {@link getPositionFills} does, then keeps the
 * cursor moving: every `pollingInterval` it reads new pool trades back to the
 * last one it saw, orders them against their blocks, and emits one fill per
 * swap. When a WebSocket is available it subscribes to the pool's trade room
 * and treats each message as a signal to poll now rather than as ordered data,
 * so a dropped socket degrades to polling instead of losing fills.
 *
 * The position's range and liquidity are held fixed. When a poll finds them
 * changed, the watch reports a {@link PositionTrackingError} and stops, since
 * pool rows cannot say which swaps happened at the old liquidity. Restart the
 * watch to track the new state.
 *
 * Hits the network continuously and opens a WebSocket; signs nothing. The API
 * client must already hold a session or API token.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param api An authenticated DEX API client for the same network.
 * @param params The position, callbacks, replay depth, and transport knobs.
 * @returns A function that stops the watch. Safe to call more than once.
 *
 * @example
 * ```ts
 * const stop = client.watchPositionFills({
 *   positionTokenId,
 *   onFill: (fill, { replayed }) => console.log(replayed ? 'replayed' : 'live', fill),
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
  const program = params.program ?? SHIELD_SWAP
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

  // Backfills run one at a time: each advances the shared cursor, and two in
  // flight would both read the same unseen rows and emit every fill twice.
  let queued: Promise<void> = Promise.resolve()
  const queueBackfill = (run: () => Promise<PositionFill[]>, replayed: boolean) => {
    queued = queued.then(async () => {
      if (stopped) return
      try {
        const fills = await run()
        if (stopped) return
        for (const fill of fills) params.onFill(fill, { replayed })
      } catch (error) {
        if (stopped) return
        onError(error as Error)
        if (error instanceof PositionTrackingError) stop()
      }
    })
  }

  // The replay establishes the position snapshot and cursor the live loop
  // continues from. Its failure is terminal: there is nothing to continue.
  let position: PositionSnapshot | undefined
  let cursor: FillCursor | undefined
  queueBackfill(async () => {
    try {
      const replayed = await replay(client, api, { ...params, program }, blocks)
      position = replayed.result
      cursor = replayed.cursor
      return replayed.result.fills
    } catch (error) {
      throw error instanceof PositionTrackingError
        ? error
        : new PositionTrackingError(`Fill replay failed: ${(error as Error).message}`, { cause: error })
    }
  }, true)

  const live = () => queueBackfill(() => backfill(client, api, { program }, position!, cursor!, blocks), false)
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
    // The ticket is minted before the socket opens; the replay above must have
    // resolved the pool key by the time the room is joined, so subscribing waits
    // on the queue rather than on `open` alone.
    void api
      .getWebSocketTicket()
      .then(({ token }) => {
        if (stopped) return
        socket = new WebSocket(wsUrl)
        socket.addEventListener('open', () => {
          socket!.send(JSON.stringify({ action: 'authenticate', token }))
          void queued.then(() => {
            if (stopped || !position) return
            socket!.send(JSON.stringify({ action: 'subscribe', room: `trades:${position.poolKey}` }))
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
