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
const POSITION_ID = '555field'
const LIQ = 1_000_000n

const positionPlaintext = (liquidity = LIQ) =>
  `{\n  token_id: ${POSITION_ID},\n  pool: ${POOL},\n  tick_lower: 0i32,\n  tick_upper: 100i32,\n  liquidity: ${liquidity}u128,\n  fee_growth_inside0_last_x_128: { hi: 0u128, lo: 0u128 },\n  fee_growth_inside1_last_x_128: { hi: 0u128, lo: 0u128 },\n  tokens_owed0: 0u128,\n  tokens_owed1: 0u128\n}`

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
  legIndex?: number
  executedAt?: string
  tradeType?: 'swap' | 'swap_multi_hop' | 'mint'
  sqrtPriceAfter?: string | null
}

const row = (swap: Swap) => ({
  id: swap.id,
  amount0: '0',
  amount1: '0',
  executedAt: swap.executedAt ?? `2026-01-01T00:00:0${swap.block}Z`,
  legIndex: swap.legIndex ?? 0,
  pool: POOL,
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

/** A fake indexer serving `rows` newest-first in pages, counting the calls made. */
function fakeApi(rows: ReturnType<typeof row>[], options: { baseUrl?: string } = {}) {
  const calls: Array<{ limit?: number; offset?: number }> = []
  const api = {
    baseUrl: options.baseUrl ?? 'https://api.testnet.swap.shield.fi',
    getPoolTrades: async (_key: string, query: { limit?: number; offset?: number } = {}) => {
      calls.push(query)
      const offset = query.offset ?? 0
      return { data: rows.slice(offset, offset + (query.limit ?? 100)), pagination: {} }
    },
    getWebSocketTicket: async () => ({ token: 'ticket' }),
  } as unknown as ApiClient & { rows: typeof rows }
  return { api, calls }
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

    const result = await getPositionFills(client, api, { positionTokenId: POSITION_ID })

    expect(result).toMatchObject({ poolKey: POOL, tickLower: 0, tickUpper: 100, liquidity: LIQ })
    expect(result.start).toEqual({ sqrtPriceX128: Q128, tick: 0, tradeId: 't1' })
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

  it('limits the replay to `history` fills, reading one extra swap for the starting price', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api } = fakeApi([row(swaps[2]!), row(swaps[1]!), row(swaps[0]!)])

    const result = await getPositionFills(client, api, { positionTokenId: POSITION_ID, history: 1 })

    expect(result.start.tradeId).toBe('t2')
    expect(result.fills.map((fill) => fill.tradeId)).toEqual(['t3'])
  })

  it('skips liquidity rows and seeds the price from the slot when the pool has no swaps', async () => {
    const client = fakeClient({
      mappings: { ...mappings, [`slots:${POOL}`]: slotPlaintext(30) },
      swaps: [],
    })
    const { api } = fakeApi([row({ id: 'm1', tx: 'at1m', block: 1, txIndex: 0, tick: 0, tradeType: 'mint' })])

    const result = await getPositionFills(client, api, { positionTokenId: POSITION_ID })

    expect(result.start).toEqual({ sqrtPriceX128: getSqrtPriceAtTickX128(30), tick: 30, tradeId: null })
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

    const result = await getPositionFills(client, api, { positionTokenId: POSITION_ID, history: 2 })

    expect(calls.map((call) => call.offset)).toEqual([0, 100])
    // Newest by chain order is s0 (txIndex 100): the three most recent swaps are
    // s2, s1, s0, and s2 only establishes the starting price.
    expect(result.start.tradeId).toBe('s2')
    expect(result.fills.map((fill) => fill.tradeId)).toEqual(['s1', 's0'])
  })

  it('rejects a missing position with a terminal error', async () => {
    const client = fakeClient({ mappings: {}, swaps })
    const { api } = fakeApi([])
    await expect(getPositionFills(client, api, { positionTokenId: POSITION_ID })).rejects.toBeInstanceOf(
      PositionTrackingError,
    )
  })

  it('refuses to replay across an indexed swap without an ending price', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api } = fakeApi([row({ ...swaps[1]!, sqrtPriceAfter: null }), row(swaps[0]!)])
    await expect(getPositionFills(client, api, { positionTokenId: POSITION_ID })).rejects.toThrow(
      /t2 has no sqrtPriceAfter/,
    )
  })

  it('rejects a negative or fractional history before touching the network', async () => {
    const client = fakeClient({ mappings, swaps })
    const { api, calls } = fakeApi([])
    await expect(getPositionFills(client, api, { positionTokenId: POSITION_ID, history: -1 })).rejects.toThrow(
      /non-negative integer/,
    )
    await expect(getPositionFills(client, api, { positionTokenId: POSITION_ID, history: 1.5 })).rejects.toThrow(
      /non-negative integer/,
    )
    expect(calls).toEqual([])
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
    const { api, calls } = fakeApi([row(initial[1]!), row(initial[0]!)])
    const fills: Array<[string, boolean]> = []
    const errors: Error[] = []

    const stop = watchPositionFills(client, api, {
      positionTokenId: POSITION_ID,
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
    ;(api as unknown as { rows: unknown[] }).rows = []
    const rows = [row({ id: 'c1', tx: 'at1z', block: 8, txIndex: 1, tick: 100, tradeType: 'mint' }), row(t3), row(initial[1]!), row(initial[0]!)]
    api.getPoolTrades = async (_key, query = {}) => {
      calls.push(query)
      const offset = query.offset ?? 0
      return { data: rows.slice(offset, offset + (query.limit ?? 100)), pagination: {} } as never
    }

    await vi.advanceTimersByTimeAsync(1000)
    expect(fills).toEqual([
      ['t2', true],
      ['t3', false],
    ])
    expect(fills[1]).toBeDefined()

    // Nothing new: the next poll emits nothing and reports nothing.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fills).toHaveLength(2)
    expect(errors).toEqual([])

    stop()
    const pollsBeforeStop = calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.length).toBe(pollsBeforeStop)
  })

  it('stops with a PositionTrackingError when the position changes under it', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', undefined)
    const swaps = [...initial]
    const changing = { [`positions:${POSITION_ID}`]: positionPlaintext() }
    const client = fakeClient({ mappings: changing, swaps })
    const { api, calls } = fakeApi([row(initial[1]!), row(initial[0]!)])
    const errors: Error[] = []

    watchPositionFills(client, api, {
      positionTokenId: POSITION_ID,
      pollingInterval: 1000,
      onFill: () => {},
      onError: (error) => errors.push(error),
    })
    await vi.advanceTimersByTimeAsync(0)

    // Liquidity was increased, and a swap landed that cannot be attributed to
    // either liquidity value.
    changing[`positions:${POSITION_ID}`] = positionPlaintext(LIQ * 2n)
    const t3: Swap = { id: 't3', tx: 'at1c', block: 8, txIndex: 0, tick: 100 }
    swaps.push(t3)
    const rows = [row(t3), row(initial[1]!), row(initial[0]!)]
    api.getPoolTrades = async (_key, query = {}) => {
      calls.push(query)
      return { data: rows.slice(query.offset ?? 0), pagination: {} } as never
    }

    await vi.advanceTimersByTimeAsync(1000)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(PositionTrackingError)
    expect(errors[0]!.message).toMatch(/position changed/)

    // Stopped: no further polls.
    const polls = calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls.length).toBe(polls)
  })

  it('reports a transient indexer failure and keeps polling', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', undefined)
    const client = fakeClient({ mappings, swaps: initial })
    const { api, calls } = fakeApi([row(initial[1]!), row(initial[0]!)])
    const errors: Error[] = []

    const stop = watchPositionFills(client, api, {
      positionTokenId: POSITION_ID,
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

  it('treats a failed replay as terminal', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', undefined)
    const client = fakeClient({ mappings: {}, swaps: [] })
    const { api, calls } = fakeApi([])
    const errors: Error[] = []

    watchPositionFills(client, api, {
      positionTokenId: POSITION_ID,
      pollingInterval: 1000,
      onFill: () => {},
      onError: (error) => errors.push(error),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(PositionTrackingError)

    const polls = calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls.length).toBe(polls)
  })

  it('subscribes to the pool room over the socket and polls on each trade signal', async () => {
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

    const client = fakeClient({ mappings, swaps: initial })
    const { api, calls } = fakeApi([row(initial[1]!), row(initial[0]!)], { baseUrl: 'https://api.swap.shield.fi' })

    const stop = watchPositionFills(client, api, {
      positionTokenId: POSITION_ID,
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
      { action: 'synchronize' },
    ])

    const polls = calls.length
    socket.emit('message', JSON.stringify({ type: 'Trade' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.length).toBe(polls + 1)

    // Frames that are not trade signals do not trigger a poll.
    socket.emit('message', 'not json')
    socket.emit('message', JSON.stringify({ type: 'Heartbeat' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.length).toBe(polls + 1)

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
      positionTokenId: POSITION_ID,
      webSocketUrl: false,
      onFill: () => {},
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(Spy).not.toHaveBeenCalled()
    stop()
  })
})
