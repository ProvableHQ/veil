import { describe, it, expect } from 'vitest'
import {
  toPersistedHandle,
  fromPersistedHandle,
  isPersistedMultiHop,
} from '../../../src/utils/blinding/handles.js'
import type { SwapHandle } from '../../../src/actions/swap/swap.js'
import type { MultiHopSwapHandle } from '../../../src/actions/swap/swapMultiHop.js'

const single: SwapHandle = {
  swapId: '7field',
  blindingFactor: '1field',
  blindedAddress: 'aleo1blinded',
  tokenInId: '11field',
  tokenOutId: '22field',
  tokenInWrapped: true,
  poolKey: '1field',
  amountIn: 340282366920938463463374607431768211455n,
  zeroForOne: false,
  sqrtPriceLimit: 702075911466779181339691826087n,
  nonce: 99n,
  transactionId: 'at1swap',
  program: 'shield_swap.aleo',
}

const multi: MultiHopSwapHandle = {
  swapId: '8field',
  blindingFactor: '2field',
  blindedAddress: 'aleo1blinded2',
  tokenInId: '11field',
  tokenOutId: '33field',
  poolKeys: ['1field', '2field'],
  hops: [
    { poolKey: '1field', zeroForOne: true, sqrtPriceLimit: 1n },
    { poolKey: '2field', zeroForOne: false, sqrtPriceLimit: 164928161394119051704885410204944470744913033840n },
  ],
  amountIn: 5000n,
  amountOutMin: 4900n,
  nonce: 12345678901234567890n,
  deadline: 1785874399,
  transactionId: 'at1mh',
  program: 'shield_swap.aleo',
}

describe('persisted swap handles', () => {
  it('round-trips a single-hop handle exactly', () => {
    expect(fromPersistedHandle(toPersistedHandle(single))).toEqual(single)
  })

  it('round-trips a multi-hop handle, per-hop bounds included', () => {
    // The nested bigint inside `hops` is the reason this cannot be a mapped type
    // over the source: it needs converting element by element.
    expect(fromPersistedHandle(toPersistedHandle(multi))).toEqual(multi)
  })

  it('survives JSON, which is the whole point', () => {
    for (const handle of [single, multi]) {
      const json = JSON.stringify(toPersistedHandle(handle))
      expect(fromPersistedHandle(JSON.parse(json))).toEqual(handle)
    }
    // Serialising the live handle instead would throw — bigints are not JSON.
    expect(() => JSON.stringify(single)).toThrow(TypeError)
  })

  it('keeps u128 precision that a number would lose', () => {
    const persisted = toPersistedHandle(single)
    expect(persisted.amountIn).toBe('340282366920938463463374607431768211455')
    // Going through Number would silently corrupt it — the double cannot hold
    // 39 digits, so it rounds and comes back a different amount.
    expect(BigInt(Number(persisted.amountIn))).not.toBe(single.amountIn)
    // The string path is exact.
    expect(fromPersistedHandle(persisted).amountIn).toBe(single.amountIn)
  })

  it('omits absent optional fields rather than storing undefined', () => {
    const bare: SwapHandle = {
      tokenInId: '11field',
      tokenOutId: '22field',
      poolKey: '1field',
      amountIn: 1n,
      transactionId: 'at1bare',
      program: 'shield_swap.aleo',
    }
    const persisted = toPersistedHandle(bare)
    // A round trip must not invent keys: `'nonce' in handle` is load-bearing for
    // callers deciding whether a swap carried an explicit nonce.
    expect('nonce' in persisted).toBe(false)
    expect('swapId' in persisted).toBe(false)
    expect(fromPersistedHandle(persisted)).toEqual(bare)
  })

  it('distinguishes the two shapes structurally, without a stored tag', () => {
    expect(isPersistedMultiHop(toPersistedHandle(multi))).toBe(true)
    expect(isPersistedMultiHop(toPersistedHandle(single))).toBe(false)
  })

  it('names the field and the swap when a stored number is corrupt', () => {
    const corrupt = { ...toPersistedHandle(single), amountIn: 'not-a-number' }
    // BigInt's own message names neither, which is useless against a store of
    // many records.
    expect(() => fromPersistedHandle(corrupt)).toThrow(/7field.*amountIn/s)
  })
})
