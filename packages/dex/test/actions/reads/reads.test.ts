import { describe, it, expect } from 'vitest'
import type { Client } from '@veil/core'
import { getSlot } from '../../../src/actions/reads/getSlot.js'
import { getSwapOutput } from '../../../src/actions/reads/getSwapOutput.js'
import {
  isBlindedAddressUsed,
  isPoolInitialized,
  isFeeTierValid,
  isTickSpacingValid,
  getFeeToTickSpacing,
} from '../../../src/actions/reads/validation.js'

// Real `slots` mapping value captured from testnet (shield_swap, ETHx/USDC pool).
const REAL_SLOT_PLAINTEXT =
  '{\n  tick: -62200i32,\n  tick_spacing: 200u32,\n  sqrt_price: 411435173233802309u128,\n  fee_protocol: 0u8,\n  liquidity: 94217047056u128,\n  fee_growth_global0_x_64: 0u128,\n  fee_growth_global1_x_64: 0u128,\n  fee_residual0_x_64: 0u128,\n  fee_residual1_x_64: 0u128,\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -64400i32,\n  next_init_above: -60000i32\n}'

// Crafted per the SwapOutput ABI struct — no live fixture exists because
// swap_outputs entries are consumed by the claim; the e2e covers the live path.
const SWAP_OUTPUT_PLAINTEXT =
  '{\n  recipient: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc,\n  caller: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc,\n  token_in: 11field,\n  token_out: 22field,\n  amount_out: 995000u128,\n  amount_remaining: 0u128,\n  token_in_1: 0field,\n  amount_remaining_1: 0u128,\n  token_in_2: 0field,\n  amount_remaining_2: 0u128\n}'

/** Fake client that records the request and returns a canned response. */
function fakeClient(response: unknown) {
  const calls: unknown[] = []
  const client = {
    request: async (req: unknown) => {
      calls.push(req)
      return response
    },
  } as unknown as Client
  return { client, calls }
}

describe('getSlot', () => {
  it('decodes a real slots mapping value with correct widths', async () => {
    const { client } = fakeClient(REAL_SLOT_PLAINTEXT)
    const slot = await getSlot(client, { poolKey: '1field' })
    expect(slot).not.toBeNull()
    expect(slot!.tick).toBe(-62200)
    expect(typeof slot!.tick).toBe('number')
    expect(slot!.tick_spacing).toBe(200)
    expect(slot!.fee_protocol).toBe(0)
    expect(slot!.sqrt_price).toBe(411435173233802309n)
    expect(typeof slot!.sqrt_price).toBe('bigint')
    expect(slot!.liquidity).toBe(94217047056n)
    expect(slot!.max_liquidity_per_tick).toBe(9223372036854775808n)
    expect(slot!.next_init_below).toBe(-64400)
    expect(slot!.next_init_above).toBe(-60000)
  })

  it('returns null for a missing pool', async () => {
    const { client } = fakeClient(null)
    expect(await getSlot(client, { poolKey: '999field' })).toBeNull()
  })
})

describe('getSwapOutput', () => {
  it('decodes a swap output struct', async () => {
    const { client } = fakeClient(SWAP_OUTPUT_PLAINTEXT)
    const out = await getSwapOutput(client, { swapId: '7field' })
    expect(out).not.toBeNull()
    expect(out!.recipient.startsWith('aleo1')).toBe(true)
    expect(out!.token_in).toBe('11field')
    expect(out!.token_out).toBe('22field')
    expect(out!.amount_out).toBe(995000n)
    expect(typeof out!.amount_out).toBe('bigint')
    expect(out!.amount_remaining).toBe(0n)
  })

  it('returns null when not finalized or already claimed', async () => {
    const { client } = fakeClient(null)
    expect(await getSwapOutput(client, { swapId: '7field' })).toBeNull()
  })
})

describe('validation reads', () => {
  it('isBlindedAddressUsed: true when set, false when absent', async () => {
    const used = fakeClient('true')
    expect(await isBlindedAddressUsed(used.client, { address: 'aleo1abc' })).toBe(true)
    const fresh = fakeClient(null)
    expect(await isBlindedAddressUsed(fresh.client, { address: 'aleo1abc' })).toBe(false)
  })

  it('isPoolInitialized maps absence to false', async () => {
    const { client } = fakeClient(null)
    expect(await isPoolInitialized(client, { poolKey: '1field' })).toBe(false)
  })

  it('isFeeTierValid encodes the key as u16', async () => {
    const { client, calls } = fakeClient('true')
    expect(await isFeeTierValid(client, { fee: 100 })).toBe(true)
    expect((calls[0] as { params: { key: string } }).params.key).toBe('100u16')
  })

  it('isTickSpacingValid encodes the key as u32', async () => {
    const { client, calls } = fakeClient('true')
    expect(await isTickSpacingValid(client, { tickSpacing: 200 })).toBe(true)
    expect((calls[0] as { params: { key: string } }).params.key).toBe('200u32')
  })

  it('getFeeToTickSpacing decodes the real chain value and nulls on absence', async () => {
    // Real chain response for fee_to_tick_spacing[100u16] on testnet.
    const bound = fakeClient('1u32')
    expect(await getFeeToTickSpacing(bound.client, { fee: 100 })).toBe(1)
    const missing = fakeClient(null)
    expect(await getFeeToTickSpacing(missing.client, { fee: 9999 })).toBeNull()
  })
})
