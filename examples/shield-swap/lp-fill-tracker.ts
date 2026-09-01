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
 * Set the account, Provable API, and position environment variables used by
 * `setupClient`, then start the live tracker from the repository root:
 *
 * ```sh
 * export VEIL_E2E_PRIVATE_KEY='APrivateKey1...'
 * export ALEO_CONSUMER_ID='...'
 * export ALEO_DPS_API_KEY='...'
 * export VEIL_POSITION_TOKEN_ID='...field'
 * pnpm exec tsx -e \
 *   "import('./examples/shield-swap/lp-fill-tracker.ts').then(({ default: m }) => m.trackLiquidityPosition())"
 * ```
 *
 * `SHIELD_SWAP_WS_URL` is optional; the client selects the testnet or mainnet
 * endpoint from its API base URL. The first REST page is the starting snapshot,
 * so reported totals cover swaps observed after startup. Inventory fills do not
 * represent the position's accrued fees.
 */
import {
  amountsForLiquidity,
  getSqrtPriceAtTickX128,
} from '../../packages/shield-swap/src/index.js'
import { findBlockHash, getBlock } from '../../packages/core/src/index.js'
import { setupClient } from './setup-client.js'

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
 * Adds the block height and transaction index to the `IndexedPoolTrade` type
 * returned by the API so the trade event can be ordered precisely.
 *
 * @property blockHeight Block height containing the transaction.
 * @property transactionIndex Transaction order within the block.
 */
type CanonicalTrade = IndexedPoolTrade & {
  blockHeight: number
  transactionIndex: number
}

/**
 * Describes a fixed-liquidity position before and after one pool price move.
 *
 * All square-root prices use Shield Swap's Q128 fixed-point encoding. The
 * calculation is local and does not read the network.
 *
 * @property liquidity Position liquidity in the contract's unsigned integer units.
 * @property sqrtLowerX128 Square-root price at the position's lower tick in Q128.
 * @property sqrtUpperX128 Square-root price at the position's upper tick in Q128.
 * @property sqrtPriceBeforeX128 Pool square-root price before the swap in Q128.
 * @property sqrtPriceAfterX128 Pool square-root price after the swap in Q128.
 */
export type PositionFillParameters = {
  liquidity: bigint
  sqrtLowerX128: bigint
  sqrtUpperX128: bigint
  sqrtPriceBeforeX128: bigint
  sqrtPriceAfterX128: bigint
}

/**
 * Reports the position's signed token inventory change for one price move.
 *
 * Positive values add token inventory and negative values remove it. Amounts
 * use each token's smallest unit.
 *
 * @property amount0 Signed change in the token0 amount backing the position.
 * @property amount1 Signed change in the token1 amount backing the position.
 */
export type PositionFill = { amount0: bigint; amount1: bigint }

/**
 * Calculates a position's token inventory change across one pool price move.
 *
 * Concentrated liquidity represents different token amounts at different
 * prices. This function values the same liquidity and tick range at both
 * prices, then applies `delta = amountAfter - amountBefore` independently to
 * token0 and token1. It runs locally and does not read the network.
 *
 * @param params Fixed liquidity, range boundaries, and consecutive pool prices.
 * @returns Signed token0 and token1 changes in each token's smallest unit.
 *
 * @example
 * ```ts
 * const fill = calculatePositionFill({
 *   liquidity: 1_000_000n,
 *   sqrtLowerX128: getSqrtPriceAtTickX128(-100),
 *   sqrtUpperX128: getSqrtPriceAtTickX128(100),
 *   sqrtPriceBeforeX128: getSqrtPriceAtTickX128(0),
 *   sqrtPriceAfterX128: getSqrtPriceAtTickX128(10),
 * })
 * ```
 */
export function calculatePositionFill(params: PositionFillParameters): PositionFill {
  const range = {
    liquidity: params.liquidity,
    sqrtLowerX128: params.sqrtLowerX128,
    sqrtUpperX128: params.sqrtUpperX128,
  }
  const before = amountsForLiquidity({ ...range, sqrtPriceX128: params.sqrtPriceBeforeX128 })
  const after = amountsForLiquidity({ ...range, sqrtPriceX128: params.sqrtPriceAfterX128 })

  return {
    amount0: after.amount0 - before.amount0,
    amount1: after.amount1 - before.amount1,
  }
}

/**
 * Configures liquidity-position tracking.
 *
 * @property watch Continue polling REST and listening for WebSocket messages
 * after the initial backfill. Defaults to `true`; set to `false` for a one-shot
 * check.
 */
export type TrackLiquidityPositionOptions = {
  watch?: boolean
}

/**
 * Tracks a liquidity position's token inventory changes from process start.
 *
 * Reads the position and pool from the Aleo network, then reports a signed fill
 * for each newly indexed swap. The function performs network reads and opens a
 * WebSocket when `watch` is enabled; it does not sign or submit transactions.
 * Logged net and gross amounts cover the current run rather than the position's
 * lifetime.
 *
 * @param options Controls whether tracking continues after the initial backfill.
 * `watch` defaults to `true`.
 * @returns When `watch` is `false`, resolves after the initial backfill;
 * otherwise remains pending while the tracker runs.
 * @throws If the position or pool cannot be read, transaction order cannot be
 * resolved, an indexed swap lacks an execution price, REST history no longer
 * overlaps the local cursor, or the position's range or liquidity changes.
 *
 * @example
 * ```ts
 * await trackLiquidityPosition()
 *
 * // Stop after the initial REST backfill.
 * await trackLiquidityPosition({ watch: false })
 * ```
 */
export async function trackLiquidityPosition(options: TrackLiquidityPositionOptions = {}): Promise<void> {
  // Step 1: Load the position identified by its NFT token id. The position
  // mapping is the source of truth for its pool, tick range, and liquidity.
  const positionTokenId = process.env.VEIL_POSITION_TOKEN_ID
  if (!positionTokenId) throw new Error('Set VEIL_POSITION_TOKEN_ID to the position NFT token_id.')

  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })
  const position = await client.getPosition({ positionTokenId })
  if (!position) throw new Error(`Position ${positionTokenId} does not exist on chain.`)

  // Step 2: Hold the position constant and prepare the fill accumulator. A
  // position's token inventory can change as price moves even when its liquidity
  // remains unchanged.
  const range = {
    liquidity: position.liquidity,
    sqrtLowerX128: getSqrtPriceAtTickX128(position.tick_lower),
    sqrtUpperX128: getSqrtPriceAtTickX128(position.tick_upper),
  }
  const seen = new Set<string>()
  const blocks = new Map<string, Awaited<ReturnType<typeof getBlock>>>()

  // Net totals preserve direction; gross totals sum absolute changes. Together
  // they distinguish final inventory movement from total inventory turnover.
  let net0 = 0n
  let net1 = 0n
  let gross0 = 0n
  let gross1 = 0n

  // REST timestamps do not establish execution order. Resolve each transaction
  // against its Aleo block, then sort by block, transaction, and multi-hop leg.
  // Consecutive prices are meaningful only in this canonical order.
  const canonicalize = async (trades: IndexedPoolTrade[]): Promise<CanonicalTrade[]> => {
    const ordered = await Promise.all(
      trades.map(async (trade) => {
        const blockHash = await findBlockHash(client, { transactionId: trade.transactionHash })
        let block = blocks.get(blockHash)
        if (!block) {
          block = await getBlock(client, { hash: blockHash })
          blocks.set(blockHash, block)
        }
        const confirmed = block.transactions?.find(
          ({ transaction }) => (transaction as { id?: string }).id === trade.transactionHash,
        )
        if (!confirmed) {
          throw new Error(`Transaction ${trade.transactionHash} was not found in block ${blockHash}.`)
        }
        return {
          ...trade,
          blockHeight: block.header.metadata.height,
          transactionIndex: confirmed.index,
        }
      }),
    )
    return ordered.sort(
      (a, b) =>
        a.blockHeight - b.blockHeight ||
        a.transactionIndex - b.transactionIndex ||
        a.legIndex - b.legIndex,
    )
  }

  // Step 3: Treat the current REST page as the starting snapshot. Existing rows
  // establish the price cursor but do not count toward this run's fill totals.
  const firstPage = await client.api.getPoolTrades(position.pool, { limit: 100, offset: 0 })
  const baseline = firstPage.data as IndexedPoolTrade[]
  for (const trade of baseline) seen.add(trade.id)

  // The latest indexed swap supplies the starting price. The on-chain slot is
  // needed only when the pool has no indexed swap history.
  const newestSwap = baseline.find(
    (trade) => trade.tradeType === 'swap' || trade.tradeType === 'swap_multi_hop',
  )
  if (newestSwap && newestSwap.sqrtPriceAfter === null) {
    throw new Error(`Latest indexed swap ${newestSwap.id} has no sqrtPriceAfter; cannot establish a price cursor.`)
  }
  const newestSwapTime = newestSwap?.executedAt
  const latestCandidates = baseline.filter(
    (trade) =>
      (trade.tradeType === 'swap' || trade.tradeType === 'swap_multi_hop') &&
      trade.executedAt === newestSwapTime,
  )
  const incompleteBaseline = latestCandidates.find((trade) => trade.sqrtPriceAfter === null)
  if (incompleteBaseline) {
    throw new Error(`Indexed swap ${incompleteBaseline.id} has no sqrtPriceAfter; cannot establish a price cursor.`)
  }
  const latest = (await canonicalize(latestCandidates)).at(-1)
  const slot = latest ? null : await client.getSlot({ poolKey: position.pool })
  const initialSqrtPrice = latest?.sqrtPriceAfter ? BigInt(latest.sqrtPriceAfter) : slot?.sqrt_price
  if (initialSqrtPrice === undefined) throw new Error(`Pool ${position.pool} has neither a slot nor indexed swaps.`)
  let previousSqrtPrice: bigint = initialSqrtPrice

  console.log(
    `tracking position ${positionTokenId}`,
    `pool ${position.pool}`,
    `range [${position.tick_lower}, ${position.tick_upper})`,
    `liquidity ${position.liquidity}`,
  )

  // Step 4: Read backward through REST pages until a previously seen trade
  // appears. This overlap prevents missed trades when more than one page arrives
  // between updates.
  const backfill = async (): Promise<void> => {
    const unseen: IndexedPoolTrade[] = []
    let offset = 0
    let reachedKnownTrade = false

    while (!reachedKnownTrade) {
      const page = await client.api.getPoolTrades(position.pool, { limit: 100, offset })
      const rows = page.data as IndexedPoolTrade[]
      reachedKnownTrade = rows.some((trade) => seen.has(trade.id))
      unseen.push(...rows.filter((trade) => !seen.has(trade.id)))
      if (reachedKnownTrade) break
      if (rows.length < 100) {
        throw new Error('REST history no longer overlaps the local cursor; restart from a fresh snapshot.')
      }
      offset += rows.length
    }
    if (!unseen.length) return

    // Pool rows cannot identify which position changed liquidity. Stop when the
    // tracked position changes because swaps cannot then be assigned to the old
    // and new liquidity values without a canonical position-event stream.
    const current = await client.getPosition({ positionTokenId })
    if (
      !current ||
      current.pool !== position.pool ||
      current.tick_lower !== position.tick_lower ||
      current.tick_upper !== position.tick_upper ||
      current.liquidity !== position.liquidity
    ) {
      throw new Error('The tracked position changed; restart from a fresh position and pool snapshot.')
    }

    // Step 5: Mint, collect, and liquidity-management rows are not fills. For
    // each swap, value the fixed position at the previous and ending prices;
    // their difference is the position's inventory fill for that swap.
    const swaps = unseen.filter(
      (trade) => trade.tradeType === 'swap' || trade.tradeType === 'swap_multi_hop',
    )
    const incompleteSwap = swaps.find((trade) => trade.sqrtPriceAfter === null)
    if (incompleteSwap) {
      throw new Error(`Indexed swap ${incompleteSwap.id} has no sqrtPriceAfter; refusing to advance the cursor.`)
    }
    for (const trade of await canonicalize(swaps)) {
      const sqrtPriceAfter = BigInt(trade.sqrtPriceAfter!)
      const fill = calculatePositionFill({
        ...range,
        sqrtPriceBeforeX128: previousSqrtPrice,
        sqrtPriceAfterX128: sqrtPriceAfter,
      })
      previousSqrtPrice = sqrtPriceAfter
      net0 += fill.amount0
      net1 += fill.amount1
      gross0 += fill.amount0 < 0n ? -fill.amount0 : fill.amount0
      gross1 += fill.amount1 < 0n ? -fill.amount1 : fill.amount1

      // Trade fees are pool-wide totals. Exact position fees come from the
      // contract's fee-growth accumulators and cannot be derived from one row.
      const lpFee0 = BigInt(trade.fee0 ?? '0') - BigInt(trade.protocolFee0 ?? '0')
      const lpFee1 = BigInt(trade.fee1 ?? '0') - BigInt(trade.protocolFee1 ?? '0')
      console.log({
        blockHeight: trade.blockHeight,
        transactionIndex: trade.transactionIndex,
        transactionHash: trade.transactionHash,
        legIndex: trade.legIndex,
        positionDelta0: fill.amount0.toString(),
        positionDelta1: fill.amount1.toString(),
        net0: net0.toString(),
        net1: net1.toString(),
        gross0: gross0.toString(),
        gross1: gross1.toString(),
        poolLpFee0: lpFee0.toString(),
        poolLpFee1: lpFee1.toString(),
      })
    }
    for (const trade of unseen) seen.add(trade.id)
  }

  await backfill()
  if (options.watch === false) return

  // Step 6: Use WebSocket messages as invalidation signals, not ordered trade
  // data. Every signal queues the same REST backfill, and a periodic poll covers
  // dropped messages and disconnected sockets.
  let queued = Promise.resolve()
  const queueBackfill = () => {
    queued = queued.then(backfill).catch((error: unknown) => console.error('fill backfill failed', error))
  }

  const wsUrl =
    process.env.SHIELD_SWAP_WS_URL ??
    (client.api.baseUrl.includes('testnet')
      ? 'wss://ws.testnet.swap.shield.fi/ws'
      : 'wss://ws.swap.shield.fi/ws')
  const ticket = await client.api.getWebSocketTicket()
  const socket = new WebSocket(wsUrl)
  let renewal: ReturnType<typeof setInterval> | undefined

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ action: 'authenticate', token: ticket.token }))
    socket.send(JSON.stringify({ action: 'subscribe', room: `trades:${position.pool}` }))
    socket.send(JSON.stringify({ action: 'synchronize' }))
    renewal = setInterval(() => {
      void client.api
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
