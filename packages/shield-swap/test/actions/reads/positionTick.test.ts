import { describe, it, expect, vi } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getPosition } from '../../../src/actions/reads/getPosition.js'
import { getTick } from '../../../src/actions/reads/getTick.js'
import { deriveTickKey } from '../../../src/utils/keys.js'

// Plaintexts in the node's serving shape for the deployed structs: the
// `*_x_128` fee-growth fields arrive as { hi, lo } u256 structs.
const POSITION_PLAINTEXT =
  '{\n  token_id: 555field,\n  pool: 4719270064611482818245310300232007815222047549513360085395965112315873598024field,\n  tick_lower: -64400i32,\n  tick_upper: -60200i32,\n  liquidity: 94217047056u128,\n  fee_growth_inside0_last_x_128: { hi: 0u128, lo: 12345u128 },\n  fee_growth_inside1_last_x_128: { hi: 1u128, lo: 67890u128 },\n  tokens_owed0: 100u128,\n  tokens_owed1: 200u128\n}'
const TICK_PLAINTEXT =
  '{\n  pool: 4719270064611482818245310300232007815222047549513360085395965112315873598024field,\n  liquidity_net: -94217047056i128,\n  liquidity_gross: 94217047056u128,\n  tick: -60200i32,\n  fee_growth_outside0_x_128: { hi: 0u128, lo: 111u128 },\n  fee_growth_outside1_x_128: { hi: 0u128, lo: 222u128 },\n  prev: -64400i32,\n  next: 400000i32\n}'

function fakeClient(response: unknown, seenKeys?: string[]): Client {
  return {
    request: async (req: { method: string; params?: { key?: string } }) => {
      seenKeys?.push(req.params?.key ?? '')
      return response
    },
  } as unknown as Client
}

describe('getPosition', () => {
  it('decodes a positions value, joining the fee-growth u256 structs to bigints', async () => {
    const position = await getPosition(fakeClient(POSITION_PLAINTEXT), { positionTokenId: '555field' })
    expect(position).not.toBeNull()
    expect(position!.token_id).toBe('555field')
    expect(position!.tick_lower).toBe(-64400)
    expect(position!.tick_upper).toBe(-60200)
    expect(position!.liquidity).toBe(94217047056n)
    expect(position!.fee_growth_inside0_last_x_128).toBe(12345n)
    expect(position!.fee_growth_inside1_last_x_128).toBe((1n << 128n) + 67890n)
    expect(typeof position!.fee_growth_inside0_last_x_128).toBe('bigint')
    expect(position!.tokens_owed0).toBe(100n)
    expect(position!.tokens_owed1).toBe(200n)
  })

  it('keys the read by the token id itself (no hashing)', async () => {
    const keys: string[] = []
    await getPosition(fakeClient(POSITION_PLAINTEXT, keys), { positionTokenId: '555field' })
    expect(keys).toEqual(['555field'])
  })

  it('returns null when no position exists', async () => {
    expect(await getPosition(fakeClient(null), { positionTokenId: '9field' })).toBeNull()
  })
})

describe('getTick', () => {
  const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'

  it('decodes a ticks value, deriving the key from pool + tick', async () => {
    const keys: string[] = []
    const tick = await getTick(fakeClient(TICK_PLAINTEXT, keys), { poolKey: POOL_KEY, tick: -60200 })
    expect(tick).not.toBeNull()
    expect(tick!.liquidity_net).toBe(-94217047056n)
    expect(tick!.fee_growth_outside0_x_128).toBe(111n)
    expect(tick!.fee_growth_outside1_x_128).toBe(222n)
    expect(typeof tick!.fee_growth_outside0_x_128).toBe('bigint')
    expect(tick!.prev).toBe(-64400)
    expect(tick!.next).toBe(400000)
    expect(keys[0]).toBe(await deriveTickKey({ pool: POOL_KEY, tick: -60200 }))
  })

  it('uses a pre-derived tickKey without touching the derivation (WASM-free path)', async () => {
    const deriveSpy = vi.spyOn(await import('../../../src/utils/keys.js'), 'deriveTickKey')
    const keys: string[] = []
    await getTick(fakeClient(TICK_PLAINTEXT, keys), { tickKey: '777field' })
    expect(keys).toEqual(['777field'])
    expect(deriveSpy).not.toHaveBeenCalled()
    deriveSpy.mockRestore()
  })

  it('returns null for an uninitialized tick', async () => {
    expect(await getTick(fakeClient(null), { tickKey: '777field' })).toBeNull()
  })
})
