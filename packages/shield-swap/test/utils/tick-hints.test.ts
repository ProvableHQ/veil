import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@provablehq/veil-core'

const tryLoadSdk = vi.hoisted(() => vi.fn())
vi.mock('../../src/utils/sdk.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/sdk.js')>()),
  tryLoadSdk,
}))
// The walk derives a tick key per hop; the key itself is irrelevant here, so it
// is stubbed to keep the WASM peer out of the test and let the scripted client
// answer by tick instead.
vi.mock('../../src/utils/keys.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/keys.js')>()),
  deriveTickKey: async ({ tick }: { tick: number }) => `tick:${tick}`,
}))

const { pickInsertHint } = await import('../../src/utils/tick-hints.js')
const { MIN_TICK_SENTINEL } = await import('../../src/utils/q128.js')

const POOL = '1field'

/**
 * Client answering `slots` from one entry and `ticks` from a linked list.
 *
 * @param list Initialized tick → the next initialized tick above it.
 */
function chainWith(
  slot: { tick: number; next_init_below: number; next_init_above: number },
  list: Record<number, number>,
): { client: Client; tickReads: () => number } {
  let tickReads = 0
  return {
    client: {
      request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
        if (req.params?.mapping === 'slots') {
          return (
            `{\n  tick: ${slot.tick}i32,\n  tick_spacing: 60u32,\n` +
            `  sqrt_price: { lo: 0u128, hi: 1u128 },\n  liquidity: 1u128,\n` +
            `  next_init_below: ${slot.next_init_below}i32,\n  next_init_above: ${slot.next_init_above}i32,\n` +
            `  fee_growth_global0_x_128: { lo: 0u128, hi: 0u128 },\n` +
            `  fee_growth_global1_x_128: { lo: 0u128, hi: 0u128 },\n  max_liquidity_per_tick: 1u128\n}`
          )
        }
        if (req.params?.mapping === 'ticks') {
          tickReads++
          const tick = Number(String(req.params.key).replace('tick:', ''))
          const next = list[tick]
          if (next === undefined) return null
          return (
            `{\n  liquidity_gross: 1u128,\n  liquidity_net: 1i128,\n` +
            `  fee_growth_outside0_x_128: { lo: 0u128, hi: 0u128 },\n` +
            `  fee_growth_outside1_x_128: { lo: 0u128, hi: 0u128 },\n` +
            `  prev: 0i32,\n  next: ${next}i32,\n  initialized: true\n}`
          )
        }
        return null
      },
    } as unknown as Client,
    tickReads: () => tickReads,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pickInsertHint with the WASM peer available', () => {
  beforeEach(() => {
    tryLoadSdk.mockResolvedValue({})
  })

  it('walks the list and returns the target’s true predecessor', async () => {
    // Sentinel → -600 → -300 → 0. A target of -100 has -300 as predecessor,
    // which is NOT what the slot's neighbours would give (see the case below).
    const { client } = chainWith(
      { tick: 500, next_init_below: 0, next_init_above: 900 },
      { [MIN_TICK_SENTINEL]: -600, [-600]: -300, [-300]: 0, 0: 900 },
    )
    expect(await pickInsertHint(client, { poolKey: POOL, targetTick: -100 })).toBe(-300)
  })

  it('returns the sentinel when nothing is initialized below the target', async () => {
    const { client } = chainWith(
      { tick: 500, next_init_below: 0, next_init_above: 900 },
      { [MIN_TICK_SENTINEL]: 600 },
    )
    expect(await pickInsertHint(client, { poolKey: POOL, targetTick: 300 })).toBe(MIN_TICK_SENTINEL)
  })

  it('stops at the entry whose next reaches the target exactly', async () => {
    // The contract asserts hint.next >= target, so an entry pointing straight at
    // the target is the predecessor and the walk must not step past it.
    const { client } = chainWith(
      { tick: 0, next_init_below: -600, next_init_above: 600 },
      { [MIN_TICK_SENTINEL]: -600, [-600]: 300, 300: 900 },
    )
    expect(await pickInsertHint(client, { poolKey: POOL, targetTick: 300 })).toBe(-600)
  })
})

describe('pickInsertHint without the WASM peer', () => {
  beforeEach(() => {
    tryLoadSdk.mockResolvedValue(null)
  })

  it('falls back to the slot neighbours instead of throwing', async () => {
    // Deriving tick keys needs the optional peer. A wallet-backed install
    // without it could mint before the walk existed and must still be able to:
    // `mint` uses the soft loader and `increaseLiquidity` never loads WASM, so
    // throwing here would take both down.
    const { client, tickReads } = chainWith(
      { tick: 500, next_init_below: 0, next_init_above: 900 },
      { [MIN_TICK_SENTINEL]: -600, [-600]: -300, [-300]: 0 },
    )
    expect(await pickInsertHint(client, { poolKey: POOL, targetTick: -100 })).toBe(0)
    // The point of the fallback: no tick key was derived, so no WASM was needed.
    expect(tickReads()).toBe(0)
  })

  it('takes the neighbour above the current tick when it is below the target', async () => {
    const { client } = chainWith({ tick: 0, next_init_below: -600, next_init_above: 300 }, {})
    expect(await pickInsertHint(client, { poolKey: POOL, targetTick: 900 })).toBe(300)
  })

  it('returns the sentinel for a pool with no slot', async () => {
    const client = { request: async () => null } as unknown as Client
    expect(await pickInsertHint(client, { poolKey: POOL, targetTick: 0 })).toBe(MIN_TICK_SENTINEL)
  })
})

describe('pickInsertHint from a supplied tick list', () => {
  beforeEach(() => {
    tryLoadSdk.mockResolvedValue(null)
  })

  const { client, tickReads } = chainWith({ tick: 500, next_init_below: 0, next_init_above: 900 }, {})

  it('returns the exact predecessor without deriving anything', async () => {
    // The case the slot neighbours get wrong: the target sits below the current
    // tick with initialized ticks between, so `next_init_below` (0) would be
    // above the target and the contract would reject it.
    const hint = await pickInsertHint(client, {
      poolKey: POOL,
      targetTick: -100,
      initializedTicks: [-600, -300, 0, 900],
    })
    expect(hint).toBe(-300)
    expect(tickReads()).toBe(0)
  })

  it('accepts a supplier and sorts a list that arrives out of order', async () => {
    const hint = await pickInsertHint(client, {
      poolKey: POOL,
      targetTick: -100,
      initializedTicks: async () => [0, -300, 900, -600],
    })
    expect(hint).toBe(-300)
  })

  it('returns the sentinel when every tick is above the target', async () => {
    expect(
      await pickInsertHint(client, { poolKey: POOL, targetTick: -900, initializedTicks: [-600, 0] }),
    ).toBe(MIN_TICK_SENTINEL)
  })

  it('falls back to the slot when the supplier fails', async () => {
    // An unauthenticated or unreachable API must not fail a mint outright.
    const hint = await pickInsertHint(client, {
      poolKey: POOL,
      targetTick: -100,
      initializedTicks: async () => {
        throw new Error('401')
      },
    })
    expect(hint).toBe(0)
  })

  it('is ignored when the WASM peer is present, because the chain is authoritative', async () => {
    tryLoadSdk.mockResolvedValue({})
    const walkable = chainWith(
      { tick: 500, next_init_below: 0, next_init_above: 900 },
      { [MIN_TICK_SENTINEL]: -600, [-600]: -300, [-300]: 0 },
    )
    // The list says -300 too, but a deliberately wrong one proves which won.
    const hint = await pickInsertHint(walkable.client, {
      poolKey: POOL,
      targetTick: -100,
      initializedTicks: [-599],
    })
    expect(hint).toBe(-300)
    expect(walkable.tickReads()).toBeGreaterThan(0)
  })
})
