import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { isGlobalPaused } from '../../../src/actions/reads/isGlobalPaused.js'
import { isPoolCreationOpen } from '../../../src/actions/reads/isPoolCreationOpen.js'
import { isTokenAllowed } from '../../../src/actions/reads/isTokenAllowed.js'
import { isTokenPaused } from '../../../src/actions/reads/isTokenPaused.js'
import { isPairPaused } from '../../../src/actions/reads/isPairPaused.js'
import { getFrozenPosition } from '../../../src/actions/reads/getFrozenPosition.js'
import { getTokenDecimals } from '../../../src/actions/reads/getTokenDecimals.js'
import { getTradeControls } from '../../../src/actions/reads/getTradeControls.js'

const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
const POOL_PLAINTEXT = `{\n  token0: ${TOKEN0},\n  token1: ${TOKEN1},\n  fee: 10000u16,\n  enabled: true,\n  scale0: 1000000000u128,\n  scale1: 1u128\n}`

/** Scripted client answering getMappingValue by mapping name (and key). */
function fakeClient(responses: Record<string, unknown | ((key?: string) => unknown)>): Client {
  return {
    request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
      if (req.method !== 'getMappingValue') throw new Error(`unexpected method ${req.method}`)
      const r = responses[req.params?.mapping ?? '']
      return typeof r === 'function' ? r(req.params?.key) : (r ?? null)
    },
  } as unknown as Client
}

describe('control readers', () => {
  it('treats an absent entry as the contract get_or_use default (false / null)', async () => {
    const client = fakeClient({})
    expect(await isGlobalPaused(client)).toBe(false)
    expect(await isPoolCreationOpen(client)).toBe(false)
    expect(await isTokenAllowed(client, { tokenId: TOKEN0 })).toBe(false)
    expect(await isTokenPaused(client, { tokenId: TOKEN0 })).toBe(false)
    expect(await isPairPaused(client, { token0: TOKEN0, token1: TOKEN1 })).toBe(false)
    expect(await getFrozenPosition(client, { positionTokenId: '5field' })).toBeNull()
    expect(await getTokenDecimals(client, { tokenId: TOKEN0 })).toBeNull()
  })

  it('reads set entries with the right key literals', async () => {
    const seen: string[] = []
    const client = fakeClient({
      global_paused: (key?: string) => (seen.push(`global:${key}`), 'true'),
      frozen_position: '123456u32',
      token_decimals: '18u8',
    })
    expect(await isGlobalPaused(client)).toBe(true)
    expect(seen).toEqual(['global:true'])
    expect(await getFrozenPosition(client, { positionTokenId: '5field' })).toBe(123456)
    expect(await getTokenDecimals(client, { tokenId: TOKEN0 })).toBe(18)
  })

  it('sorts the pair key ascending, order-independent, matching set_pair_paused', async () => {
    const keys: string[] = []
    const client = fakeClient({ pair_paused: (key?: string) => (keys.push(key!), 'true') })
    await isPairPaused(client, { token0: TOKEN0, token1: TOKEN1 })
    await isPairPaused(client, { token0: TOKEN1, token1: TOKEN0 })
    expect(keys[0]).toBe(keys[1])
    // TOKEN0's numeric value is below TOKEN1's — sorted ascending.
    expect(keys[0]).toBe(`{ token0: ${TOKEN0}, token1: ${TOKEN1} }`)
  })

  it('rejects an unexpected numeric literal shape', async () => {
    const client = fakeClient({ token_decimals: 'garbage' })
    await expect(getTokenDecimals(client, { tokenId: TOKEN0 })).rejects.toThrow(/unexpected value/)
  })
})

describe('getTradeControls', () => {
  it('reports every gate and a true verdict on a clean pool', async () => {
    const client = fakeClient({ pools: POOL_PLAINTEXT, token_allowed: 'true' })
    const controls = await getTradeControls(client, { poolKey: '1field' })
    expect(controls).toEqual({
      globalPaused: false,
      poolEnabled: true,
      token0: { tokenId: TOKEN0, allowed: true, paused: false },
      token1: { tokenId: TOKEN1, allowed: true, paused: false },
      pairPaused: false,
      tradeable: true,
    })
  })

  it('flips tradeable when any swap-finalize gate blocks', async () => {
    const paused = await getTradeControls(fakeClient({ pools: POOL_PLAINTEXT, global_paused: 'true' }), {
      poolKey: '1field',
    })
    expect(paused.tradeable).toBe(false)

    const tokenPaused = await getTradeControls(
      fakeClient({ pools: POOL_PLAINTEXT, token_paused: (key?: string) => (key === TOKEN1 ? 'true' : null) }),
      { poolKey: '1field' },
    )
    expect(tokenPaused.token1.paused).toBe(true)
    expect(tokenPaused.tradeable).toBe(false)

    const pairPaused = await getTradeControls(fakeClient({ pools: POOL_PLAINTEXT, pair_paused: 'true' }), {
      poolKey: '1field',
    })
    expect(pairPaused.tradeable).toBe(false)
  })

  it('does not let the create_pool-only allowlist affect the verdict', async () => {
    // Both tokens un-allowed (absent) — the swap finalize never reads
    // token_allowed, so an existing pool stays tradeable.
    const controls = await getTradeControls(fakeClient({ pools: POOL_PLAINTEXT }), { poolKey: '1field' })
    expect(controls.token0.allowed).toBe(false)
    expect(controls.tradeable).toBe(true)
  })

  it('throws when the pool does not exist', async () => {
    await expect(getTradeControls(fakeClient({}), { poolKey: '9field' })).rejects.toThrow(/does not exist/)
  })
})
