import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import type { ApiClient } from '../../../src/api/client.js'
import {
  PositionTrackingError,
  calculatePositionFill,
  getPositionFills,
  watchPositionFills,
} from '../../../src/actions/reads/positionFills.js'
import { getSqrtPriceAtTickX128, toU256Parts } from '../../../src/utils/q128.js'

const Q128 = 1n << 128n
const SQRT_TICK_100_X128 = 341987953891916247014855103371247308527n
const POOL = '999field'
const POOL_B = '888field'
const POSITION_ID = '555field'
const POSITION_B = '556field'
const POSITION_C = '557field'
const LIQ = 1_000_000n

const positionPlaintext = (opts: { id?: string; pool?: string; liquidity?: bigint; tickLower?: number; tickUpper?: number } = {}) =>
  `{\n  token_id: ${opts.id ?? POSITION_ID},\n  pool: ${opts.pool ?? POOL},\n  tick_lower: ${opts.tickLower ?? 0}i32,\n  tick_upper: ${opts.tickUpper ?? 100}i32,\n  liquidity: ${opts.liquidity ?? LIQ}u128,\n  fee_growth_inside0_last_x_128: { hi: 0u128, lo: 0u128 },\n  fee_growth_inside1_last_x_128: { hi: 0u128, lo: 0u128 },\n  tokens_owed0: 0u128,\n  tokens_owed1: 0u128\n}`

const slotPlaintext = (tick: number) => {
  const sp = toU256Parts(getSqrtPriceAtTickX128(tick))
  return `{\n  tick: ${tick}i32,\n  tick_spacing: 10i32,\n  sqrt_price: { hi: ${sp.hi}u128, lo: ${sp.lo}u128 },\n  fee_protocol: 0u8,\n  liquidity: ${LIQ}u128,\n  fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 },\n  fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 },\n  max_liquidity_per_tick: 100000000000000000000u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: 0i32,\n  next_init_above: 100i32\n}`
}

/** A swap as the indexer serves it, at a given block/tx position on chain. */
type Swap = {
  id: string
  tx: string
  block: number
  txIndex: number
  tick: number
  pool?: string
  legIndex?: number
  executedAt?: string
  tradeType?: 'swap' | 'swap_multi_hop' | 'mint'
  sqrtPriceAfter?: string | null
}

const row = (swap: Swap) => ({
  id: swap.id,
  amount0: '0',
  amount1: '0',
  executedAt: swap.executedAt ?? `2026-01-01T00:00:${String(swap.block).padStart(2, '0')}Z`,
  legIndex: swap.legIndex ?? 0,
  pool: swap.pool ?? POOL,
  sqrtPriceAfter:
    swap.sqrtPriceAfter === undefined ? getSqrtPriceAtTickX128(swap.tick).toString() : swap.sqrtPriceAfter,
  tickAfter: swap.sqrtPriceAfter === null ? null : swap.tick,
  tradeType: swap.tradeType ?? 'swap',
  transactionHash: swap.tx,
})

/**
 * A fake node: mapping reads keyed `mapping:key`, plus blocks reconstructed
 * from the swaps so `findBlockHash` and `getBlockByHash` resolve chain order.
 */
function fakeClient(opts: { mappings: Record<string, string | null>; swaps: Swap[] }): Client {
  const blockOf = (height: number) => ({
    block_hash: `ab${height}`,
    header: { metadata: { height } },
    transactions: opts.swaps
      .filter((swap) => swap.block === height)
      .map((swap) => ({
        index: swap.txIndex,
        transaction: {
          id: swap.tx,
          execution: {
            transitions: [
              { id: `au-fee-${swap.id}`, program: 'credits.aleo', function: 'fee_public' },
              { id: `au-${swap.id}`, program: 'shield_swap.aleo', function: swap.tradeType ?? 'swap' },
            ],
          },
        },
      })),
  })
  return {
    request: async (req: { method: string; params: Record<string, unknown> }) => {
      if (req.method === 'getMappingValue') return opts.mappings[`${req.params.mapping}:${req.params.key}`] ?? null
      if (req.method === 'findBlockHash') {
        const swap = opts.swaps.find((candidate) => candidate.tx === req.params.transactionId)
        if (!swap) throw new Error(`unknown tx ${req.params.transactionId}`)
        return `ab${swap.block}`
      }
      if (req.method === 'getBlockByHash') return blockOf(Number(String(req.params.hash).slice(2)))
      throw new Error(`unexpected ${req.method}`)
    },
  } as unknown as Client
}

type Row = ReturnType<typeof row>

/**
 * A fake indexer serving rows newest-first in pages, per pool, counting the
 * calls made. `rows` is mutable so a test can land new trades between polls.
 */
function fakeApi(initial: Row[] | Record<string, Row[]>, options: { baseUrl?: string } = {}) {
  const rows: Record<string, Row[]> = Array.isArray(initial) ? { [POOL]: initial } : initial
  const calls: Array<{ pool: string; limit?: number; offset?: number }> = []
  const api = {
    baseUrl: options.baseUrl ?? 'https://api.testnet.swap.shield.fi',
    getPoolTrades: async (pool: string, query: { limit?: number; offset?: number } = {}) => {
      calls.push({ pool, ...query })
      const offset = query.offset ?? 0
      return { data: (rows[pool] ?? []).slice(offset, offset + (query.limit ?? 100)), pagination: {} }
    },
    getWebSocketTicket: async () => ({ token: 'ticket' }),
  } as unknown as ApiClient
  return { api, calls, rows }
}

const fillIdentity = {
  tradeId: 'trade-1',
  positionTokenId: POSITION_ID,
  poolKey: POOL,
  transactionId: 'at1transaction',
  transitionId: 'au1transition',
  blockHeight: 123,
  transactionIndex: 4,
  transitionIndex: 2,
  legIndex: 0,
}

describe('calculatePositionFill', () => {
  it('values the fixed liquidity at both prices as price crosses the range', () => {
    expect(
      calculatePositionFill({
        ...fillIdentity,
        positionLiquidity: LIQ,
        tickLower: 0,
        tickUpper: 100,
        sqrtPriceBeforeX128: Q128,
        sqrtPriceAfterX128: SQRT_TICK_100_X128,
        tickBefore: 0,
        tickAfter: 100,
        zeroForOne: false,
      }),
    ).toMatchObject({ amount0Before: 4987n, amount1Before: 0n, amount0After: 0n, amount1After: 5012n })
  })

  it('reverses the inventory states when price traverses the range the other way', () => {
    expect(
      calculatePositionFill({
        ...fillIdentity,
        positionLiquidity: LIQ,
        tickLower: 0,
        tickUpper: 100,
        sqrtPriceBeforeX128: SQRT_TICK_100_X128,
        sqrtPriceAfterX128: Q128,
        tickBefore: 100,
        tickAfter: 0,
        zeroForOne: true,
      }),
    ).toMatchObject({ amount0Before: 0n, amount1Before: 5012n, amount0After: 4987n, amount1After: 0n })
  })
})

describe('getPositionFills', () => {
  // Three swaps whose indexer order (by timestamp) disagrees with chain order:
  // the two in block 7 share a timestamp, and the indexer lists them reversed.
  const swaps: Swap[] = [
    { id: 't1', tx: 'at1a', block: 5, txIndex: 0, tick: 0 },
    { id: 't2', tx: 'at1b', block: 7, txIndex: 1, tick: 50, executedAt: '2026-01-01T00:00:07Z' },
    { id: 't3', tx: 'at1c', block: 7, txIndex: 3, tick: 100, executedAt: '2026-01-01T00:00:07Z' },
  ]
  const mappings = { [`positions:${POSITION_ID}`]: positionPlaintext() }

  it('orders indexed swaps by chain position and measures each fill from the previous price', async () => {
    const client = fakeClient({ mappings, swaps })
    // Newest-first as the indexer serves it, with the same-second pair reversed.
    const { api } = fakeApi([row(swaps[1]!), row(swaps[2]!), row(swaps[0]!)])

    const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID] })

    expect(result.positions).toEqual([
      {
        positionTokenId: POSITION_ID,
        poolKey: POOL,
        tickLower: 0,
        tickUpper: 100,
        liquidity: LIQ,
        start: { sqrtPriceX128: Q128, tick: 0, tradeId: 't1' },
      },
    ])
    expect(result.fills.map((fill) => fill.tradeId)).toEqual(['t2', 't3'])
    expect(result.fills[0]).toMatchObject({
      transactionIndex: 1,
      transitionIndex: 1,
      transitionId: 'au-t2',
      tickBefore: 0,
      tickAfter: 50,
      zeroForOne: false,
      amount0Before: 4987n,
      amount1Before: 0n,
    })
    expect(result.fills[1]).toMatchObject({ tickBefore: 50, tickAfter: 100, amount0After: 0n, amount1After: 5012n })
    // The chain of inventories is continuous.
    expect(result.fills[1]!.amount0Before).toBe(result.fills[0]!.amount0After)
  })

  it('values several positions in one pool against a single read of its history', async () => {
    const client = fakeClient({
      mappings: {
        ...mappings,
        [`positions:${POSITION_B}`]: positionPlaintext({ id: POSITION_B, liquidity: LIQ * 2n, tickLower: 40, tickUpper: 60 }),
      },
      swaps,
    })
    const { api, calls } = fakeApi([row(swaps[2]!), row(swaps[1]!), row(swaps[0]!)])

    const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID, POSITION_B] })

    // One page read serves both positions.
    expect(calls).toHaveLength(1)
    expect(result.positions.map((position) => position.positionTokenId)).toEqual([POSITION_ID, POSITION_B])
    expect(result.positions[1]!.start).toEqual(result.positions[0]!.start)
    // One fill per swap per position, swaps in chain order, positions in request order.
    expect(result.fills.map((fill) => [fill.tradeId, fill.positionTokenId])).toEqual([
      ['t2', POSITION_ID],
      ['t2', POSITION_B],
      ['t3', POSITION_ID],
      ['t3', POSITION_B],
    ])
    // The narrow position starts below its range (all token0) and the move to
    // tick 50 carries it inside, so it is valued at its own liquidity and range.
    expect(result.fills[1]).toMatchObject({ positionLiquidity: LIQ * 2n, tickLower: 40, tickUpper: 60, amount1Before: 0n })
    expect(result.fills[1]!.amount0Before).toBeGreaterThan(0n)
    expect(result.fills[1]!.amount1After).toBeGreaterThan(0n)
    expect(result.fills[1]!.amount0After).toBeLessThan(result.fills[1]!.amount0Before)
  })

  it('merges fills from positions in different pools into one chain-ordered list', async () => {
    const poolBSwaps: Swap[] = [
      { id: 'b1', tx: 'at1x', block: 4, txIndex: 0, tick: 0, pool: POOL_B },
      { id: 'b2', tx: 'at1y', block: 6, txIndex: 0, tick: 20, pool: POOL_B },
      { id: 'b3', tx: 'at1z', block: 8, txIndex: 0, tick: 40, pool: POOL_B },
    ]
    const client = fakeClient({
      mappings: { ...mappings, [`positions:${POSITION_B}`]: positionPlaintext({ id: POSITION_B, pool: POOL_B }) },
      swaps: [...swaps, ...poolBSwaps],
    })
    const { api, calls } = fakeApi({
      [POOL]: [row(swaps[2]!), row(swaps[1]!), row(swaps[0]!)],
      [POOL_B]: poolBSwaps.map(row).reverse(),
    })

    const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID, POSITION_B] })

    expect(calls.map((call) => call.pool).sort()).toEqual([POOL_B, POOL].sort())
    expect(result.positions[0]!.start.tradeId).toBe('t1')
    expect(result.positions[1]!.start.tradeId).toBe('b1')
    // Blocks 6 (b2), 7 (t2, t3), 8 (b3).
    expect(result.fills.map((fill) => fill.tradeId)).toEqual(['b2', 't2', 't3', 'b3'])
    expect(result.fills.map((fill) => fill.poolKey)).toEqual([POOL_B, POOL, POOL, POOL_B])
  })

  it('limits the replay to `history` fills, reading one extra swap for the starting price', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api } = fakeApi([row(swaps[2]!), row(swaps[1]!), row(swaps[0]!)])

    const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID], history: 1 })

    expect(result.positions[0]!.start.tradeId).toBe('t2')
    expect(result.fills.map((fill) => fill.tradeId)).toEqual(['t3'])
  })

  describe('fromBlock', () => {
    // Five swaps across two indexer pages; block 7 straddles the boundary.
    const many: Swap[] = [
      { id: 'f1', tx: 'at1f1', block: 3, txIndex: 0, tick: 0 },
      { id: 'f2', tx: 'at1f2', block: 5, txIndex: 0, tick: 10 },
      { id: 'f3', tx: 'at1f3', block: 7, txIndex: 0, tick: 20, executedAt: '2026-01-01T00:00:07Z' },
      { id: 'f4', tx: 'at1f4', block: 7, txIndex: 2, tick: 30, executedAt: '2026-01-01T00:00:07Z' },
      { id: 'f5', tx: 'at1f5', block: 9, txIndex: 0, tick: 40 },
    ]

    it('replays every swap at or after the block, seeded by the swap just before it', async () => {
      const client = fakeClient({ mappings, swaps: many })
      const { api } = fakeApi(many.map(row).reverse())

      const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID], fromBlock: 7 })

      expect(result.positions[0]!.start.tradeId).toBe('f2')
      expect(result.fills.map((fill) => fill.tradeId)).toEqual(['f3', 'f4', 'f5'])
      expect(result.fills[0]).toMatchObject({ tickBefore: 10, tickAfter: 20 })
    })

    it('stops paging once a page ends past a swap older than the window', async () => {
      // Pages of 100: 101 old swaps at block 1 fill page one exactly, and page
      // two holds the last of them. The window swap sits first.
      const old: Swap[] = Array.from({ length: 101 }, (_, i) => ({
        id: `o${i}`,
        tx: `at1o${i}`,
        block: 1,
        txIndex: i,
        tick: 1 + i,
        executedAt: '2026-01-01T00:00:01Z',
      }))
      const recent: Swap = { id: 'r1', tx: 'at1r1', block: 10, txIndex: 0, tick: 200 }
      const client = fakeClient({ mappings, swaps: [...old, recent] })
      const { api, calls } = fakeApi([row(recent), ...old.map(row).reverse()])

      const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID], fromBlock: 10 })

      // Page one ends on block-1 rows that share a timestamp, so page two is
      // read to be sure none of them is newer; a third page is never needed.
      expect(calls.map((call) => call.offset)).toEqual([0, 100])
      // The newest pre-window swap by chain order is o100 (txIndex 100).
      expect(result.positions[0]!.start.tradeId).toBe('o100')
      expect(result.fills.map((fill) => fill.tradeId)).toEqual(['r1'])
    })

    it('seeds from the earliest swap in the window when nothing precedes it', async () => {
      const client = fakeClient({ mappings, swaps: many })
      const { api } = fakeApi(many.map(row).reverse())

      const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID], fromBlock: 0 })

      expect(result.positions[0]!.start.tradeId).toBe('f1')
      expect(result.fills.map((fill) => fill.tradeId)).toEqual(['f2', 'f3', 'f4', 'f5'])
    })

    it('ignores a priceless legacy swap that falls outside the window', async () => {
      const legacy: Swap = { id: 'f0', tx: 'at1f0', block: 1, txIndex: 0, tick: 0, sqrtPriceAfter: null }
      const client = fakeClient({ mappings, swaps: [legacy, ...many] })
      const { api } = fakeApi([...many.map(row).reverse(), row(legacy)])

      const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID], fromBlock: 7 })

      expect(result.positions[0]!.start.tradeId).toBe('f2')
      expect(result.fills.map((fill) => fill.tradeId)).toEqual(['f3', 'f4', 'f5'])
      // The same row inside the window is still fatal.
      await expect(getPositionFills(client, api, { positionTokenIds: [POSITION_ID], fromBlock: 1 })).rejects.toThrow(
        /f0 has no sqrtPriceAfter/,
      )
    })

    it('refuses to combine fromBlock with history', async () => {
      const client = fakeClient({ mappings, swaps: many })
      const { api, calls } = fakeApi([])
      await expect(
        getPositionFills(client, api, { positionTokenIds: [POSITION_ID], fromBlock: 7, history: 3 }),
      ).rejects.toThrow(/pass one of them/)
      expect(calls).toEqual([])
    })
  })

  it('skips liquidity rows and seeds the price from the slot when the pool has no swaps', async () => {
    const client = fakeClient({
      mappings: { ...mappings, [`slots:${POOL}`]: slotPlaintext(30) },
      swaps: [],
    })
    const { api } = fakeApi([row({ id: 'm1', tx: 'at1m', block: 1, txIndex: 0, tick: 0, tradeType: 'mint' })])

    const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID] })

    expect(result.positions[0]!.start).toEqual({ sqrtPriceX128: getSqrtPriceAtTickX128(30), tick: 30, tradeId: null })
    expect(result.fills).toEqual([])
  })

  it('pages past the cutoff while rows still share its timestamp', async () => {
    // 100 same-second swaps fill page one exactly; the sort needs page two's
    // remaining sibling before it can say which of them is oldest.
    const many: Swap[] = Array.from({ length: 101 }, (_, i) => ({
      id: `s${i}`,
      tx: `at1s${i}`,
      block: 9,
      txIndex: 100 - i,
      tick: 1 + i,
      executedAt: '2026-01-01T00:00:09Z',
    }))
    const client = fakeClient({ mappings, swaps: many })
    const { api, calls } = fakeApi(many.map(row))

    const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID], history: 2 })

    expect(calls.map((call) => call.offset)).toEqual([0, 100])
    // Newest by chain order is s0 (txIndex 100): the three most recent swaps are
    // s2, s1, s0, and s2 only establishes the starting price.
    expect(result.positions[0]!.start.tradeId).toBe('s2')
    expect(result.fills.map((fill) => fill.tradeId)).toEqual(['s1', 's0'])
  })

  it('rejects a missing position with a terminal error naming it', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api } = fakeApi([])
    const error = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID, POSITION_B] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PositionTrackingError)
    expect((error as PositionTrackingError).positionTokenIds).toEqual([POSITION_B])
  })

  it('refuses to replay across an indexed swap without an ending price', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api } = fakeApi([row({ ...swaps[1]!, sqrtPriceAfter: null }), row(swaps[0]!)])
    await expect(getPositionFills(client, api, { positionTokenIds: [POSITION_ID] })).rejects.toThrow(
      /t2 has no sqrtPriceAfter/,
    )
  })

  it('rejects an empty id list and a bad history before touching the network', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api, calls } = fakeApi([])
    await expect(getPositionFills(client, api, { positionTokenIds: [] })).rejects.toThrow(/at least one position/)
    await expect(getPositionFills(client, api, { positionTokenIds: [POSITION_ID], history: -1 })).rejects.toThrow(
      /non-negative integer/,
    )
    await expect(getPositionFills(client, api, { positionTokenIds: [POSITION_ID], history: 1.5 })).rejects.toThrow(
      /non-negative integer/,
    )
    expect(calls).toEqual([])
  })

  it('collapses a repeated id into one position', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api } = fakeApi([row(swaps[2]!), row(swaps[1]!), row(swaps[0]!)])
    const result = await getPositionFills(client, api, { positionTokenIds: [POSITION_ID, POSITION_ID] })
    expect(result.positions).toHaveLength(1)
    expect(result.fills).toHaveLength(2)
  })
})

describe('watchPositionFills', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const mappings = { [`positions:${POSITION_ID}`]: positionPlaintext() }
  const initial: Swap[] = [
    { id: 't1', tx: 'at1a', block: 5, txIndex: 0, tick: 0 },
    { id: 't2', tx: 'at1b', block: 6, txIndex: 0, tick: 50 },
  ]

  it('replays, then emits each newly indexed swap once as polls find it', async () => {
    vi.useFakeTimers()
    // The socket is out of scope here; the poll is the path under test.
    vi.stubGlobal('WebSocket', undefined)
    const swaps = [...initial]
    const client = fakeClient({ mappings, swaps })
    const { api, calls, rows } = fakeApi([row(initial[1]!), row(initial[0]!)])
    const fills: Array<[string, boolean]> = []
    const errors: Error[] = []

    const stop = watchPositionFills(client, api, {
      positionTokenIds: [POSITION_ID],
      pollingInterval: 1000,
      onFill: (fill, { replayed }) => fills.push([fill.tradeId, replayed]),
      onError: (error) => errors.push(error),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fills).toEqual([['t2', true]])

    // A new swap lands at the head of the indexer's list, along with a
    // liquidity row that must be marked seen without producing a fill.
    const t3: Swap = { id: 't3', tx: 'at1c', block: 8, txIndex: 0, tick: 100 }
    swaps.push(t3)
    rows[POOL] = [row({ id: 'c1', tx: 'at1z', block: 8, txIndex: 1, tick: 100, tradeType: 'mint' }), row(t3), ...rows[POOL]!]

    await vi.advanceTimersByTimeAsync(1000)
    expect(fills).toEqual([
      ['t2', true],
      ['t3', false],
    ])

    // Nothing new: the next poll emits nothing and reports nothing.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fills).toHaveLength(2)
    expect(errors).toEqual([])

    stop()
    const pollsBeforeStop = calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.length).toBe(pollsBeforeStop)
  })

  it('drops a position that changes under it and keeps tracking the rest', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', undefined)
    const swaps = [...initial]
    const changing = {
      [`positions:${POSITION_ID}`]: positionPlaintext(),
      [`positions:${POSITION_B}`]: positionPlaintext({ id: POSITION_B, tickLower: -100, tickUpper: 0 }),
    }
    const client = fakeClient({ mappings: changing, swaps })
    const { api, calls, rows } = fakeApi([row(initial[1]!), row(initial[0]!)])
    const fills: Array<[string, string]> = []
    const errors: Error[] = []

    watchPositionFills(client, api, {
      positionTokenIds: [POSITION_ID, POSITION_B],
      pollingInterval: 1000,
      onFill: (fill) => fills.push([fill.tradeId, fill.positionTokenId]),
      onError: (error) => errors.push(error),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fills).toEqual([
      ['t2', POSITION_ID],
      ['t2', POSITION_B],
    ])

    // The first position's liquidity was increased, and a swap landed that
    // cannot be attributed to either liquidity value. The second is unchanged.
    changing[`positions:${POSITION_ID}`] = positionPlaintext({ liquidity: LIQ * 2n })
    const t3: Swap = { id: 't3', tx: 'at1c', block: 8, txIndex: 0, tick: 100 }
    swaps.push(t3)
    rows[POOL] = [row(t3), ...rows[POOL]!]

    await vi.advanceTimersByTimeAsync(1000)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(PositionTrackingError)
    expect((errors[0] as PositionTrackingError).positionTokenIds).toEqual([POSITION_ID])
    expect(errors[0]!.message).toMatch(/555field changed/)
    // The swap still produced a fill for the position that did not change.
    expect(fills.slice(2)).toEqual([['t3', POSITION_B]])

    // Still polling for the survivor.
    const polls = calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.length).toBeGreaterThan(polls)

    // Once the last position changes too, the watch stops itself.
    changing[`positions:${POSITION_B}`] = null
    const t4: Swap = { id: 't4', tx: 'at1d', block: 9, txIndex: 0, tick: 120 }
    swaps.push(t4)
    rows[POOL] = [row(t4), ...rows[POOL]!]
    await vi.advanceTimersByTimeAsync(1000)
    expect((errors[1] as PositionTrackingError).positionTokenIds).toEqual([POSITION_B])
    const pollsAtStop = calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls.length).toBe(pollsAtStop)
  })

  it('reports a transient indexer failure and keeps polling', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', undefined)
    const client = fakeClient({ mappings, swaps: initial })
    const { api, calls } = fakeApi([row(initial[1]!), row(initial[0]!)])
    const errors: Error[] = []

    const stop = watchPositionFills(client, api, {
      positionTokenIds: [POSITION_ID],
      pollingInterval: 1000,
      onFill: () => {},
      onError: (error) => errors.push(error),
    })
    await vi.advanceTimersByTimeAsync(0)

    const healthy = api.getPoolTrades
    api.getPoolTrades = async () => {
      throw new Error('503 Service Unavailable')
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(errors.map((error) => error.message)).toEqual(['503 Service Unavailable'])

    api.getPoolTrades = healthy
    const polls = calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.length).toBeGreaterThan(polls)
    stop()
  })

  it('drops a position that cannot be read and stops when none remain', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', undefined)
    const client = fakeClient({ mappings: {}, swaps: [] })
    const { api, calls } = fakeApi([])
    const errors: Error[] = []

    watchPositionFills(client, api, {
      positionTokenIds: [POSITION_ID, POSITION_C],
      pollingInterval: 1000,
      onFill: () => {},
      onError: (error) => errors.push(error),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(errors).toHaveLength(2)
    expect(errors.map((error) => (error as PositionTrackingError).positionTokenIds)).toEqual([[POSITION_ID], [POSITION_C]])

    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toEqual([])
  })

  it('subscribes to every pool room over the socket and polls on each trade signal', async () => {
    vi.useFakeTimers()
    // A scripted socket: records frames sent and lets the test push messages.
    const sockets: FakeSocket[] = []
    class FakeSocket {
      sent: string[] = []
      closed = false
      listeners = new Map<string, Array<(event: { data?: string }) => void>>()
      constructor(public url: string) {
        sockets.push(this)
      }
      addEventListener(type: string, listener: (event: { data?: string }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }
      send(frame: string) {
        this.sent.push(frame)
      }
      close() {
        this.closed = true
      }
      emit(type: string, data?: string) {
        for (const listener of this.listeners.get(type) ?? []) listener({ data })
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket)

    const poolB: Swap[] = [{ id: 'b1', tx: 'at1x', block: 4, txIndex: 0, tick: 0, pool: POOL_B }]
    const client = fakeClient({
      mappings: { ...mappings, [`positions:${POSITION_B}`]: positionPlaintext({ id: POSITION_B, pool: POOL_B }) },
      swaps: [...initial, ...poolB],
    })
    const { api, calls } = fakeApi(
      { [POOL]: [row(initial[1]!), row(initial[0]!)], [POOL_B]: poolB.map(row) },
      { baseUrl: 'https://api.swap.shield.fi' },
    )

    const stop = watchPositionFills(client, api, {
      positionTokenIds: [POSITION_ID, POSITION_B],
      pollingInterval: 60_000,
      onFill: () => {},
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(sockets).toHaveLength(1)
    const socket = sockets[0]!
    expect(socket.url).toBe('wss://ws.swap.shield.fi/ws')
    socket.emit('open')
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { action: 'authenticate', token: 'ticket' },
      { action: 'subscribe', room: `trades:${POOL}` },
      { action: 'subscribe', room: `trades:${POOL_B}` },
      { action: 'synchronize' },
    ])

    // A trade signal polls every tracked pool once.
    const polls = calls.length
    socket.emit('message', JSON.stringify({ type: 'Trade' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.length).toBe(polls + 2)

    // Frames that are not trade signals do not trigger a poll.
    socket.emit('message', 'not json')
    socket.emit('message', JSON.stringify({ type: 'Heartbeat' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.length).toBe(polls + 2)

    stop()
    expect(socket.closed).toBe(true)
  })

  it('never opens a socket when webSocketUrl is false', async () => {
    vi.useFakeTimers()
    const Spy = vi.fn()
    vi.stubGlobal('WebSocket', Spy)
    const client = fakeClient({ mappings, swaps: initial })
    const { api } = fakeApi([row(initial[1]!), row(initial[0]!)])

    const stop = watchPositionFills(client, api, {
      positionTokenIds: [POSITION_ID],
      webSocketUrl: false,
      onFill: () => {},
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(Spy).not.toHaveBeenCalled()
    stop()
  })
})
