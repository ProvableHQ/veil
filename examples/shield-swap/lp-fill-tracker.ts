import {
  amountsForLiquidity,
  getSqrtPriceAtTickX128,
} from '../../packages/shield-swap/src/index.js'
import { findBlockHash, getBlock } from '../../packages/core/src/index.js'
import { setupClient } from './setup-client.js'

// The deployed endpoint already includes execution fields that the repository's
// checked-in generated OpenAPI snapshot predates. Keep that narrow schema drift
// local to this example instead of regenerating hundreds of unrelated API types.
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

type CanonicalTrade = IndexedPoolTrade & {
  blockHeight: number
  transactionIndex: number
}

/** Inputs required to derive one position's inventory change across a price move. */
export type PositionFillParameters = {
  liquidity: bigint
  sqrtLowerX128: bigint
  sqrtUpperX128: bigint
  sqrtPriceBeforeX128: bigint
  sqrtPriceAfterX128: bigint
}

/** Token inventory gained or lost by a position during a price move. */
export type PositionFill = { amount0: bigint; amount1: bigint }

/** Calculates the position's token deltas across one pool price transition. */
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

/** Options for {@link trackLiquidityPosition}. */
export type TrackLiquidityPositionOptions = {
  /** Keep following REST/WebSocket updates. Defaults to true. */
  watch?: boolean
}

/**
 * Tracks a liquidity position's token inventory changes from process start.
 *
 * Reads `VEIL_POSITION_TOKEN_ID` from the environment, backfills pool trades
 * from the Shield Swap REST API, and verifies their canonical order against the
 * Aleo chain. When watching, WebSocket messages prompt faster backfills and
 * periodic polling covers missed messages or disconnected sockets. Logged net
 * and gross amounts cover the current run rather than the position's lifetime.
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
  const positionTokenId = process.env.VEIL_POSITION_TOKEN_ID
  if (!positionTokenId) throw new Error('Set VEIL_POSITION_TOKEN_ID to the position NFT token_id.')

  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })
  const position = await client.getPosition({ positionTokenId })
  if (!position) throw new Error(`Position ${positionTokenId} does not exist on chain.`)

  const range = {
    liquidity: position.liquidity,
    sqrtLowerX128: getSqrtPriceAtTickX128(position.tick_lower),
    sqrtUpperX128: getSqrtPriceAtTickX128(position.tick_upper),
  }
  const seen = new Set<string>()
  const blocks = new Map<string, Awaited<ReturnType<typeof getBlock>>>()
  let net0 = 0n
  let net1 = 0n
  let gross0 = 0n
  let gross1 = 0n

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

  const firstPage = await client.api.getPoolTrades(position.pool, { limit: 100, offset: 0 })
  const baseline = firstPage.data as IndexedPoolTrade[]
  for (const trade of baseline) seen.add(trade.id)

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

      // These are pool-wide LP fees. Exact per-position fees are settled from
      // fee-growth accumulators and cannot be allocated from this row alone.
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
      // Unknown frames cannot advance state; the periodic REST read remains authoritative.
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
