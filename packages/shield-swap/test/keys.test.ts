import { describe, it, expect } from 'vitest'

import {
  derivePoolKey,
  deriveTickKey,
  deriveSwapId,
  derivePositionTokenId,
  deriveMultiHopSwapId,
  formatSwapKeyPreimage,
  formatSwapMultiHopRequestPreimage,
} from '../src/utils/keys.js'

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

describe('deriveSwapId / derivePositionTokenId / deriveMultiHopSwapId', () => {
  const blinded = 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h'
  const poolKey =
    '5004171258545595848890767719949996982906438837519254032156408929642095152812field'
  // Position token ids hash the unchanged TokenIDPreimage — the pinned vector
  // survives the shield_swap.aleo migration.
  const POSITION_TOKEN_ID_VECTOR =
    '3485933773882122087930662045960488901064798188645166514302897100258129294621field'

  const swapArgs = {
    poolKey,
    zeroForOne: true,
    amountIn: 1000000000n,
    sqrtPriceLimit: 19029805711n,
    blindedAddress: blinded,
    nonce: 42n,
  }

  // TODO(devnode): re-pin exact swap-id hash vectors against a deployed
  // shield_swap.aleo once the devnode matrix runs — the U256-bearing SwapKey/
  // SwapMultiHopRequest preimages cannot be re-derived offline. Until then
  // the preimage literals below are pinned exactly and chain parity is the
  // devnode e2e's job.
  it('hashes the exact SwapKey preimage (U256 limit, blinded address twice)', async () => {
    expect(formatSwapKeyPreimage(swapArgs)).toBe(
      `{ pool: ${poolKey}, zero_for_one: true, amount_in: 1000000000u128, ` +
        `sqrt_price_limit: { hi: 0u128, lo: 19029805711u128 }, recipient: ${blinded}, ` +
        `nonce: 42u64, caller: ${blinded} }`,
    )
    // A limit above 2^128 splits into a non-zero hi half.
    expect(
      formatSwapKeyPreimage({ ...swapArgs, sqrtPriceLimit: (1n << 128n) + 7n }),
    ).toContain('sqrt_price_limit: { hi: 1u128, lo: 7u128 }')
  })

  it('derives a deterministic swap id field literal', async () => {
    const id = await deriveSwapId(swapArgs)
    expect(id).toMatch(/field$/)
    expect(await deriveSwapId(swapArgs)).toBe(id)
  })

  it('changes the swap id when the nonce changes', async () => {
    expect(await deriveSwapId({ ...swapArgs, nonce: 43n })).not.toBe(await deriveSwapId(swapArgs))
  })

  it('accepts a bare pool key literal', async () => {
    expect(await deriveSwapId({ ...swapArgs, poolKey: poolKey.replace(/field$/, '') })).toBe(
      await deriveSwapId(swapArgs),
    )
  })

  const mintRequest = {
    pool: poolKey,
    tickLower: -600,
    tickUpper: 600,
    amount0Desired: 10n,
    amount1Desired: 10n,
    amount0Min: 0n,
    amount1Min: 0n,
    tickLowerHint: -600,
    tickUpperHint: -600,
  }

  it('derives a deterministic position token id', async () => {
    const id = await derivePositionTokenId({ request: mintRequest, recipient: blinded, nonce: '7field' })
    expect(id).toBe(POSITION_TOKEN_ID_VECTOR)
  })

  const twoHop = {
    tokenInId: '1234567890123456789field',
    tokenOutId: '9876543210987654321field',
    amountIn: 1000000000n,
    amountOutMin: 1n,
    blindedAddress: blinded,
    hops: [
      { poolKey, zeroForOne: true, sqrtPriceLimit: 19029805711n },
      { poolKey, zeroForOne: false, sqrtPriceLimit: 4470386772317930780047134862n },
    ],
    nonce: 42n,
    deadline: 5000000,
  }

  it('hashes the exact SwapMultiHopRequest preimage, zero-padding the unused hop', async () => {
    expect(formatSwapMultiHopRequestPreimage(twoHop)).toBe(
      `{ token_in: 1234567890123456789field, token_out: 9876543210987654321field, ` +
        `amount_in: 1000000000u128, amount_out_min: 1u128, recipient: ${blinded}, ` +
        `hop0: { pool: ${poolKey}, zero_for_one: true, sqrt_price_limit: { hi: 0u128, lo: 19029805711u128 } }, ` +
        `hop1: { pool: ${poolKey}, zero_for_one: false, sqrt_price_limit: { hi: 0u128, lo: 4470386772317930780047134862u128 } }, ` +
        `hop2: { pool: 0field, zero_for_one: false, sqrt_price_limit: { hi: 0u128, lo: 0u128 } }, ` +
        `hop_count: 2u8, nonce: 42u64, deadline: 5000000u32, caller: ${blinded} }`,
    )
  })

  it('derives a deterministic multi-hop swap id, distinct from padding-as-hop', async () => {
    const id = await deriveMultiHopSwapId(twoHop)
    expect(id).toMatch(/field$/)
    expect(await deriveMultiHopSwapId(twoHop)).toBe(id)
    // A third real hop changes the hash — padding is not equivalent to a hop.
    expect(
      await deriveMultiHopSwapId({ ...twoHop, hops: [...twoHop.hops, twoHop.hops[0]!] }),
    ).not.toBe(id)
  })

  it('rejects a hop count outside 2–3', async () => {
    await expect(deriveMultiHopSwapId({ ...twoHop, hops: [twoHop.hops[0]!] })).rejects.toThrow(
      /2 or 3 hops/,
    )
    await expect(
      deriveMultiHopSwapId({ ...twoHop, hops: Array(4).fill(twoHop.hops[0]) }),
    ).rejects.toThrow(/2 or 3 hops/)
  })

  it('rejects a hop list with an empty slot instead of silently padding it', async () => {
    const sparse = [twoHop.hops[0], twoHop.hops[1], undefined] as unknown as typeof twoHop.hops
    await expect(deriveMultiHopSwapId({ ...twoHop, hops: sparse })).rejects.toThrow(/empty slots/)
  })

  it('accepts a bare pool key in the mint request, like the sibling derivations', async () => {
    const id = await derivePositionTokenId({
      request: { ...mintRequest, pool: poolKey.replace(/field$/, '') },
      recipient: blinded,
      nonce: '7',
    })
    expect(id).toBe(POSITION_TOKEN_ID_VECTOR)
  })
})
