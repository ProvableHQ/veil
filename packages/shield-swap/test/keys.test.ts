import { describe, it, expect } from 'vitest'

import { derivePoolKey, deriveTickKey } from '../src/utils/keys.js'

/**
 * Unit coverage for local key derivation. The golden field values are pinned
 * regression vectors; their agreement with the chain's own hashing is proven
 * authoritatively by the devnode parity assertions in
 * devnodeLifecycle.actions.e2e.test.ts (derivePoolKey === the createPool key,
 * and a deriveTickKey read locates a real tick).
 */
describe('derivePoolKey / deriveTickKey', () => {
  const token0 = '1234567890123456789field'
  const token1 = '9876543210987654321field'
  const POOL_KEY =
    '5004171258545595848890767719949996982906438837519254032156408929642095152812field'
  const TICK_KEY =
    '1831124990376748452345532981319547440239544385602656748610276036461414053413field'

  it('derives the pool key as a field literal', async () => {
    expect(await derivePoolKey({ token0, token1, fee: 3000 })).toBe(POOL_KEY)
  })

  it('is order-independent in the token pair (the contract sorts ascending)', async () => {
    expect(await derivePoolKey({ token0: token1, token1: token0, fee: 3000 })).toBe(POOL_KEY)
  })

  it('accepts bare or field-suffixed token literals', async () => {
    expect(
      await derivePoolKey({
        token0: '1234567890123456789',
        token1: '9876543210987654321',
        fee: 3000,
      }),
    ).toBe(POOL_KEY)
  })

  it('changes the key when the fee tier changes', async () => {
    expect(await derivePoolKey({ token0, token1, fee: 500 })).not.toBe(POOL_KEY)
  })

  it('derives the tick key from a pool key and tick, bare or suffixed', async () => {
    expect(await deriveTickKey({ pool: POOL_KEY, tick: -600 })).toBe(TICK_KEY)
    expect(await deriveTickKey({ pool: POOL_KEY.replace(/field$/, ''), tick: -600 })).toBe(TICK_KEY)
  })

  it('changes the tick key when the tick changes', async () => {
    expect(await deriveTickKey({ pool: POOL_KEY, tick: 600 })).not.toBe(TICK_KEY)
  })
})
