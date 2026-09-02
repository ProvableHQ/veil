/**
 * This example demonstrates how a liquidity provider can construct swap fill
 * history for a liquidity position within an individual pool.
 *
 * This example defines a position fill as the change in token0 and token1 that
 * backs the position's fixed liquidity between two consecutive pool prices.
 * The calculation combines four data sources:
 *
 * 1. The on-chain position supplies its pool, tick range, and liquidity.
 * 2. REST trade history supplies each swap's ending square-root price.
 * 3. Aleo blocks establish block, transaction, and multi-hop leg order.
 * 4. WebSocket messages announce when REST may have new trades to backfill.
 *
 * Set the account private key, then pass the position token id when starting
 * the tracker:
 *
 * ```sh
 * export VEIL_E2E_PRIVATE_KEY='APrivateKey1...'
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id>
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> --network testnet
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> --history-size 50
 * ```
 *
 * Mainnet is the default. Pass `--network testnet` to track a testnet
 * position.
 *
 * `SHIELD_SWAP_WS_URL` is optional; the client selects the testnet or mainnet
 * endpoint from its API base URL. The tracker replays up to 20 swaps by default;
 * the earliest swap establishes the starting price, so up to 19 historical
 * fills are reported. Inventory fills do not represent the position's accrued
 * fees.
 */
import {
  PROGRAM_ID,
  amountsForLiquidity,
  getSqrtPriceAtTickX128,
  shieldSwapActions,
} from '../../packages/shield-swap/src/index.js'
import {
  createClient,
  http,
  publicActions,
  type Transaction,
} from '../../packages/core/src/index.js'
import { loadNetwork } from '../../packages/provable-sdk/src/index.js'

/**
 * Pool trade payload returned by the `/pools/{key}/trades` endpoint from the
 * Shield Swap API.
 *
 * @property id Unique indexer identifier for the trade row.
 * @property amount0 Pool-wide token0 amount in the token's smallest unit.
 * @property amount1 Pool-wide token1 amount in the token's smallest unit.
 * @property executedAt Indexer timestamp for the trade.
 * @property fee0 Gross token0 swap fee in the token's smallest unit.
 * @property fee1 Gross token1 swap fee in the token's smallest unit.
 * @property legIndex Execution order of a swap leg within its transaction.
 * @property liquidityAfter Active pool liquidity after the trade.
 * @property pool ID of the pool affected by the trade.
 * @property protocolFee0 Protocol share of `fee0` in token0's smallest unit.
 * @property protocolFee1 Protocol share of `fee1` in token1's smallest unit.
 * @property sqrtPriceAfter Pool square-root price after the trade in Q128.
 * @property tickAfter Active pool tick after the trade.
 * @property tradeType Contract operation represented by the row.
 * @property transactionHash Aleo transaction id containing the trade.
 */
type IndexedPoolTrade = {
  id: string
  amount0: string
  amount1: string
  executedAt: string
  fee0: string | null
  fee1: string | null
  legIndex: number
  liquidityAfter: string | null
  pool: string
  protocolFee0: string | null
  protocolFee1: string | null
  sqrtPriceAfter: string | null
  tickAfter: number | null
  tradeType: 'mint' | 'add_liquidity' | 'remove_liquidity' | 'burn' | 'collect' | 'swap' | 'swap_multi_hop'
  transactionHash: string
}

/**
 * Adds the block height, transaction index, transition id, and transition index
 * to the type returned by the API so the trade event can be ordered precisely.
 *
 * @property blockHeight Block height containing the transaction.
 * @property transactionIndex Transaction order within the block.
 * @property transitionId ID of the transition that executed the swap.
 * @property transitionIndex Transition order within the transaction.
 */
type CanonicalTrade = IndexedPoolTrade & {
  blockHeight: number
  transactionIndex: number
  transitionId: string
  transitionIndex: number
}

/** Indicates that retrying cannot safely advance the fill cursor. */
class TerminalBackfillError extends Error {}

/** Retries temporary backfill failures every ten seconds without logging them. */
export async function retryBackfill(backfill: () => Promise<void>): Promise<void> {
  while (true) {
    try {
      return await backfill()
    } catch (error) {
      if (error instanceof TerminalBackfillError) throw error
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
  }
}

/**
 * Records a liquidity position's inventory before and after one ordered pool
 * swap.
 *
 * The position liquidity and tick range remain fixed during the swap. All
 * square-root prices use Shield Swap's Q128 encoding, and all token amounts use
 * the corresponding token's smallest unit.
 *
 * @property tradeId Unique indexer identifier for the pool trade.
 * @property positionTokenId Token id of the position NFT.
 * @property poolKey ID of the pool containing the position.
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
 * @property zeroForOne True when the swap sells token0 for token1.
 * @property amount0Before Token0 amount backing the position before the swap.
 * @property amount1Before Token1 amount backing the position before the swap.
 * @property amount0After Token0 amount backing the position after the swap.
 * @property amount1After Token1 amount backing the position after the swap.
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

/**
 * Calculates a position's token inventory before and after one pool swap.
 *
 * Concentrated liquidity represents different token amounts at different
 * prices. This function values the supplied position liquidity and tick range
 * at both pool prices. It runs locally and does not read the network.
 *
 * @param params Trade identity, chain order, fixed position state, and
 * consecutive pool prices.
 * @returns The supplied fill context with before/after position inventory.
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
export function calculatePositionFill(
  params: Omit<PositionFill, 'amount0Before' | 'amount1Before' | 'amount0After' | 'amount1After'>,
): PositionFill {
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
 * Configures liquidity-position tracking.
 *
 * @property positionTokenId Token id of the position NFT to track.
 * @property network Aleo network containing the position. Defaults to
 * `mainnet`.
 * @property historySize Number of recent pool swaps to use for the historical
 * replay. Defaults to `20`; the earliest swap establishes the starting price.
 * @property watch Continue polling REST and listening for WebSocket messages
 * after the historical replay. Defaults to `true`; set to `false` for a
 * one-shot check.
 */
export type TrackLiquidityPositionOptions = {
  positionTokenId: string
  network?: 'mainnet' | 'testnet'
  historySize?: number
  watch?: boolean
}

/**
 * Tracks a liquidity position's recent and live token inventory changes.
 *
 * Reads the position and pool from the Aleo network, reconstructs recent fills
 * from ordered pool swaps, then reports each newly indexed swap. The function
 * performs network reads and opens a WebSocket when `watch` is enabled. It
 * signs the Shield Swap authentication challenge but does not prove or submit
 * transactions.
 *
 * @param options Selects the position, network, history size, and whether
 * tracking continues after the historical replay. `network` defaults to
 * `mainnet`, `historySize` defaults to `20`, and `watch` defaults to `true`.
 * @returns When `watch` is `false`, resolves after the historical replay;
 * otherwise remains pending while the tracker runs.
 * @throws If the history size is invalid, the position or pool cannot be read,
 * transaction order cannot be resolved, an indexed swap lacks an ending price
 * or tick, the swap direction cannot be determined, REST history no longer
 * overlaps the local cursor, or the position's range or liquidity changes.
 *
 * @example
 * ```ts
 * await trackLiquidityPosition({ positionTokenId: '11field' })
 *
 * // Replay the latest 50 swaps, then stop.
 * await trackLiquidityPosition({ positionTokenId: '11field', historySize: 50, watch: false })
 * ```
 */
export async function trackLiquidityPosition(options: TrackLiquidityPositionOptions): Promise<void> {
  // Step 1: Load the position identified by its NFT token id. The position
  // mapping is the source of truth for its pool, tick range, and liquidity.
  const { positionTokenId, network = 'mainnet', historySize = 20 } = options
  if (!Number.isInteger(historySize) || historySize < 1) {
    throw new Error('History size must be a positive integer.')
  }

  const privateKey = process.env.VEIL_E2E_PRIVATE_KEY
  if (!privateKey) throw new Error('VEIL_E2E_PRIVATE_KEY is required to authenticate with Shield Swap.')

  const aleo = await loadNetwork(network)
  const swapClient = createClient({
    account: aleo.privateKeyToAccount(privateKey),
    transport: http('https://api.provable.com/v2', { network }),
  })
    .extend(publicActions)
    .extend(shieldSwapActions({ api: {} }))
  await swapClient.authenticateShieldSwap()

  const position = await swapClient.getPosition({ positionTokenId })
  if (!position) throw new Error(`Position ${positionTokenId} does not exist on chain.`)

  // Step 2: Hold the position constant. A position's token inventory can change
  // as price moves even when its liquidity remains unchanged.
  const seen = new Set<string>()
  const blocks = new Map<string, Awaited<ReturnType<typeof swapClient.getBlock>>>()

  // REST timestamps do not establish execution order. Resolve each transaction
  // against its Aleo block, then sort by block, transaction, transition, and
  // multi-hop leg. Consecutive prices are meaningful only in this order.
  const addOrdering = async (trades: IndexedPoolTrade[]): Promise<CanonicalTrade[]> => {
    const ordered = await Promise.all(
      trades.map(async (trade) => {
        const blockHash = await swapClient.findBlockHash({ transactionId: trade.transactionHash })
        let block = blocks.get(blockHash)
        if (!block) {
          block = await swapClient.getBlock({ hash: blockHash })
          blocks.set(blockHash, block)
        }
        const confirmed = block.transactions?.find(
          ({ transaction }) => (transaction as { id?: string }).id === trade.transactionHash,
        )
        if (!confirmed) {
          throw new Error(`Transaction ${trade.transactionHash} was not found in block ${blockHash}.`)
        }
        const transaction = confirmed.transaction as Transaction
        const transitionIndex =
          transaction.execution?.transitions.findIndex(
            (transition) => transition.program === PROGRAM_ID && transition.function === trade.tradeType,
          ) ?? -1
        const transition = transaction.execution?.transitions[transitionIndex]
        if (!transition) {
          throw new Error(
            `Transaction ${trade.transactionHash} has no ${PROGRAM_ID}/${trade.tradeType} transition.`,
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

  // Step 3: Read backward until the requested number of swaps has been found.
  // The endpoint also returns liquidity operations, so the number of REST rows
  // read may be greater than the requested swap history.
  const baseline: IndexedPoolTrade[] = []
  const historicalSwapRows: IndexedPoolTrade[] = []
  let historyOffset = 0

  while (true) {
    const page = await swapClient.api.getPoolTrades(position.pool, { limit: 100, offset: historyOffset })
    const rows = page.data as IndexedPoolTrade[]
    baseline.push(...rows)
    historicalSwapRows.push(
      ...rows.filter((trade) => trade.tradeType === 'swap' || trade.tradeType === 'swap_multi_hop'),
    )
    if (rows.length < 100) break
    const cutoffTime = historicalSwapRows[historySize - 1]?.executedAt
    if (cutoffTime !== undefined && rows.at(-1)?.executedAt !== cutoffTime) break
    historyOffset += rows.length
  }
  for (const trade of baseline) seen.add(trade.id)

  const cutoffTime = historicalSwapRows[historySize - 1]?.executedAt
  const selectionCandidates = historicalSwapRows.filter(
    (trade, index) => index < historySize || trade.executedAt === cutoffTime,
  )
  const orderedHistory = (await addOrdering(selectionCandidates)).slice(-historySize)
  const incompleteBaseline = orderedHistory.find(
    (trade) => trade.sqrtPriceAfter === null || trade.tickAfter === null,
  )
  if (incompleteBaseline) {
    throw new Error(
      `Indexed swap ${incompleteBaseline.id} has no sqrtPriceAfter or tickAfter; cannot replay history.`,
    )
  }
  const startingSwap = orderedHistory[0]
  const slot = startingSwap ? null : await swapClient.getSlot({ poolKey: position.pool })
  const initialSqrtPrice = startingSwap?.sqrtPriceAfter
    ? BigInt(startingSwap.sqrtPriceAfter)
    : slot?.sqrt_price
  const initialTick = startingSwap?.tickAfter ?? slot?.tick
  if (initialSqrtPrice === undefined || initialTick === undefined) {
    throw new Error(`Pool ${position.pool} has neither a slot nor indexed swaps.`)
  }
  let previousSqrtPrice: bigint = initialSqrtPrice
  let previousTick: number = initialTick

  console.log(
    `tracking position ${positionTokenId}`,
    `pool ${position.pool}`,
    `range [${position.tick_lower}, ${position.tick_upper})`,
    `liquidity ${position.liquidity}`,
  )

  // Record swaps whose before-price has already been established by the
  // historical starting point or the preceding live swap.
  const recordOrderedSwaps = (trades: CanonicalTrade[]): void => {
    for (const trade of trades) {
      const sqrtPriceAfter = BigInt(trade.sqrtPriceAfter!)
      if (sqrtPriceAfter === previousSqrtPrice) {
        throw new TerminalBackfillError(
          `Indexed swap ${trade.id} did not move the pool price; cannot determine its direction.`,
        )
      }
      const fill = calculatePositionFill({
        tradeId: trade.id,
        positionTokenId,
        poolKey: position.pool,
        transactionId: trade.transactionHash,
        transitionId: trade.transitionId,
        blockHeight: trade.blockHeight,
        transactionIndex: trade.transactionIndex,
        transitionIndex: trade.transitionIndex,
        legIndex: trade.legIndex,
        positionLiquidity: position.liquidity,
        tickLower: position.tick_lower,
        tickUpper: position.tick_upper,
        sqrtPriceBeforeX128: previousSqrtPrice,
        sqrtPriceAfterX128: sqrtPriceAfter,
        tickBefore: previousTick,
        tickAfter: trade.tickAfter!,
        zeroForOne: sqrtPriceAfter < previousSqrtPrice,
      })
      previousSqrtPrice = sqrtPriceAfter
      previousTick = trade.tickAfter!
      console.log(fill)
    }
  }

  if (startingSwap) {
    console.log(
      `history starting point is swap ${startingSwap.id}`,
      `block height ${startingSwap.blockHeight}`,
      `transaction index ${startingSwap.transactionIndex}`,
      `replaying ${orderedHistory.length - 1} fills from ${orderedHistory.length} swaps`,
    )
    recordOrderedSwaps(orderedHistory.slice(1))
  } else {
    console.log('No indexed swaps found; live tracking starts from the current pool price.')
  }

  // Step 4: Read backward through REST pages until a previously seen trade
  // appears. This overlap prevents missed trades when more than one page arrives
  // between updates.
  const backfill = async (): Promise<void> => {
    const unseen: IndexedPoolTrade[] = []
    let offset = 0
    let reachedKnownTrade = false

    while (!reachedKnownTrade) {
      const page = await swapClient.api.getPoolTrades(position.pool, { limit: 100, offset })
      const rows = page.data as IndexedPoolTrade[]
      reachedKnownTrade = rows.some((trade) => seen.has(trade.id))
      unseen.push(...rows.filter((trade) => !seen.has(trade.id)))
      if (reachedKnownTrade) break
      if (rows.length < 100) {
        if (seen.size === 0) break
        throw new TerminalBackfillError(
          'REST history no longer overlaps the local cursor; restart from a fresh snapshot.',
        )
      }
      offset += rows.length
    }
    if (!unseen.length) return

    // Pool rows cannot identify which position changed liquidity. Stop when the
    // tracked position changes because swaps cannot then be assigned to the old
    // and new liquidity values without a canonical position-event stream.
    const current = await swapClient.getPosition({ positionTokenId })
    if (
      !current ||
      current.pool !== position.pool ||
      current.tick_lower !== position.tick_lower ||
      current.tick_upper !== position.tick_upper ||
      current.liquidity !== position.liquidity
    ) {
      throw new TerminalBackfillError(
        'The tracked position changed; restart from a fresh position and pool snapshot.',
      )
    }

    // Step 5: Mint, collect, and liquidity-management rows are not fills. For
    // each swap, record the fixed position's inventory at the previous and
    // ending prices.
    const swaps = unseen.filter(
      (trade) => trade.tradeType === 'swap' || trade.tradeType === 'swap_multi_hop',
    )
    const incompleteSwap = swaps.find(
      (trade) => trade.sqrtPriceAfter === null || trade.tickAfter === null,
    )
    if (incompleteSwap) {
      throw new Error(
        `Indexed swap ${incompleteSwap.id} has no sqrtPriceAfter or tickAfter; refusing to advance the cursor.`,
      )
    }
    recordOrderedSwaps(await addOrdering(swaps))
    for (const trade of unseen) seen.add(trade.id)
  }

  await retryBackfill(backfill)
  if (options.watch === false) return

  // Step 6: Use WebSocket messages as invalidation signals, not ordered trade
  // data. Every signal queues the same REST backfill, and a periodic poll covers
  // dropped messages and disconnected sockets.
  let queued = Promise.resolve()
  const queueBackfill = () => {
    queued = queued
      .then(() => retryBackfill(backfill))
      .catch((error: unknown) => console.error('fill tracking stopped', error))
  }

  const wsUrl =
    process.env.SHIELD_SWAP_WS_URL ??
    (swapClient.api.baseUrl.includes('testnet')
      ? 'wss://ws.testnet.swap.shield.fi/ws'
      : 'wss://ws.swap.shield.fi/ws')
  const ticket = await swapClient.api.getWebSocketTicket()
  const socket = new WebSocket(wsUrl)
  let renewal: ReturnType<typeof setInterval> | undefined

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ action: 'authenticate', token: ticket.token }))
    socket.send(JSON.stringify({ action: 'subscribe', room: `trades:${position.pool}` }))
    socket.send(JSON.stringify({ action: 'synchronize' }))
    renewal = setInterval(() => {
      void swapClient.api
        .getWebSocketTicket()
        .then(({ token }) => socket.send(JSON.stringify({ action: 'authenticate', token })))
        .catch((error: unknown) => console.error('WebSocket ticket renewal failed', error))
    }, 45_000)
  })
  socket.addEventListener('message', ({ data }) => {
    try {
      const message = JSON.parse(String(data)) as { type?: string; control?: string }
      if (message.type === 'Trade' || message.control === 'synchronized' || message.control === 'resync_required') {
        queueBackfill()
      }
    } catch {
      // Unknown frames do not change the cursor; the periodic REST read remains authoritative.
    }
  })
  socket.addEventListener('close', () => {
    if (renewal) clearInterval(renewal)
    console.warn('WebSocket closed; continuing with periodic REST backfills.')
  })
  socket.addEventListener('error', (event) => console.error('WebSocket error', event))

  setInterval(queueBackfill, 10_000)
  await new Promise<void>(() => {})
}

if (process.argv[1]?.endsWith('lp-fill-tracker.ts')) {
  const positionTokenId = process.argv[2]
  const networkFlagIndex = process.argv.indexOf('--network')
  const network = networkFlagIndex === -1 ? 'mainnet' : process.argv[networkFlagIndex + 1]
  const historySizeFlagIndex = process.argv.indexOf('--history-size')
  const historySize =
    historySizeFlagIndex === -1 ? 20 : Number(process.argv[historySizeFlagIndex + 1])

  if (network !== 'mainnet' && network !== 'testnet') {
    console.error('Network must be mainnet or testnet.')
    process.exitCode = 1
  } else if (!Number.isInteger(historySize) || historySize < 1) {
    console.error('History size must be a positive integer.')
    process.exitCode = 1
  } else if (!positionTokenId) {
    console.error(
      'Usage: pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> [--network mainnet|testnet] [--history-size N]',
    )
    process.exitCode = 1
  } else {
    void trackLiquidityPosition({ positionTokenId, network, historySize }).catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
  }
}
