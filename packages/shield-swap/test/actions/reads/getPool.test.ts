import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getPool } from '../../../src/actions/reads/getPool.js'

// `pools` mapping value in the deployed shield_swap.aleo shape — four fields,
// no decimal scales (amounts are raw native units throughout the stack).
const POOL_PLAINTEXT =
  '{\n  token0: 122352848155208110005843045field,\n  token1: 15594200448253854747971580789field,\n  fee: 10000u16,\n  enabled: true\n}'

function fakeClient(response: unknown): Client {
  return { request: async () => response } as unknown as Client
}

describe('getPool', () => {
  it('decodes a pools mapping value into a typed PoolState', async () => {
    const pool = await getPool(fakeClient(POOL_PLAINTEXT), { poolKey: '1field' })
    expect(pool).not.toBeNull()
    expect(pool!.token0).toBe('122352848155208110005843045field')
    expect(typeof pool!.token0).toBe('string')
    expect(pool!.token1).toBe('15594200448253854747971580789field')
    expect(pool!.fee).toBe(10000)
    expect(typeof pool!.fee).toBe('number')
    expect(pool!.enabled).toBe(true)
    // No per-pool decimal scales exist in this deployment.
    expect('scale0' in pool!).toBe(false)
  })

  it('returns null when the key is not in the mapping', async () => {
    // The node returns JSON null for a missing key (transport decodes to JS null).
    expect(await getPool(fakeClient(null), { poolKey: '999field' })).toBeNull()
    // Defensive only: no current transport delivers the literal string "null",
    // but a raw pass-through transport would — keep the guard honest.
    expect(await getPool(fakeClient('null'), { poolKey: '999field' })).toBeNull()
  })
})
