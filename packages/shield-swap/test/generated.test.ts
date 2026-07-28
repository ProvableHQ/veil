import { describe, it, expect } from 'vitest'
import type { RecordValue, StructValue } from '@provablehq/veil-core'
import {
  PROGRAM_ID,
  toPositionNFT,
  toSwapComplianceRecord,
  toSlot,
  toPoolState,
  type Slot,
  type PoolState,
  type Position,
  type U256__8JquwLopp8,
} from '../src/generated/shield_swap.js'

const ZERO = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'

// U256 mapping values arrive as a decoded { hi, lo } struct (core's
// parsePlaintextValue yields plain objects with bigint members).
const u256 = (hi: bigint, lo: bigint) => ({ hi, lo })

// PROGRAM_ID is the program the bindings target, stamped by codegen from the
// ABI named in veil.config.json.
describe('PROGRAM_ID', () => {
  it('targets the shield_swap deployment', () => {
    expect(PROGRAM_ID).toBe('shield_swap.aleo')
  })
})

// toSlot exercises mixed widths (i32/u32 → number, u128 → bigint) and the
// Q128.128 U256 struct fields (sqrt_price, fee growth) that pass through as
// { hi, lo } objects.
describe('toSlot', () => {
  // Struct decoders take the plain StructValue parsePlaintextValue returns.
  const value: StructValue = {
    tick: -60n,
    tick_spacing: 60n,
    sqrt_price: u256(1n, 0n),
    liquidity: 1000000n,
    fee_growth_global0_x_128: u256(0n, 5n),
    fee_growth_global1_x_128: u256(0n, 0n),
  }

  it('decodes i32/u32 as number, u128 as bigint, and U256 as a {hi,lo} struct', () => {
    const slot: Slot = toSlot(value)
    expect(slot.tick).toBe(-60)
    expect(typeof slot.tick).toBe('number')
    expect(slot.tick_spacing).toBe(60)
    expect(slot.liquidity).toBe(1000000n)
    expect(typeof slot.liquidity).toBe('bigint')
    expect(slot.sqrt_price).toEqual({ hi: 1n, lo: 0n })
    expect(slot.fee_growth_global0_x_128).toEqual({ hi: 0n, lo: 5n })
  })
})

describe('toPoolState', () => {
  const value: StructValue = {
    token0: '11field',
    token1: '22field',
    fee: 3000n,
    enabled: true,
  }

  it('decodes field→string, u16→number, bool→boolean; carries no scale fields', () => {
    const pool: PoolState = toPoolState(value)
    expect(pool.token0).toBe('11field')
    expect(pool.fee).toBe(3000)
    expect(typeof pool.fee).toBe('number')
    expect(pool.enabled).toBe(true)
    expect('scale0' in pool).toBe(false)
  })
})

describe('toPositionNFT', () => {
  const record: RecordValue = {
    owner: ZERO,
    program: 'shield_swap.aleo',
    recordName: 'PositionNFT',
    nonce: '0group',
    entries: {
      withdrawal: { value: ZERO, visibility: 'private', type: { kind: 'primitive', primitive: 'address' } },
      token_id: { value: '1234field', visibility: 'private', type: { kind: 'primitive', primitive: 'field' } },
      token0_id: { value: '11field', visibility: 'private', type: { kind: 'primitive', primitive: 'field' } },
      token1_id: { value: '22field', visibility: 'private', type: { kind: 'primitive', primitive: 'field' } },
      pool: { value: '99field', visibility: 'private', type: { kind: 'primitive', primitive: 'field' } },
      tick_lower: { value: -887272n, visibility: 'private', type: { kind: 'primitive', primitive: 'i32' } },
      tick_upper: { value: 887272n, visibility: 'private', type: { kind: 'primitive', primitive: 'i32' } },
    },
  }

  it('decodes owner, the immutable withdrawal address, string ids, and i32 ticks', () => {
    const nft = toPositionNFT(record)
    expect(nft.owner).toBe(ZERO)
    expect(nft.withdrawal).toBe(ZERO)
    expect(nft.token_id).toBe('1234field')
    expect(nft.pool).toBe('99field')
    expect(nft.tick_lower).toBe(-887272)
    expect(nft.tick_upper).toBe(887272)
    expect(typeof nft.tick_lower).toBe('number')
    expect(nft._record).toBe(record)
  })
})

// Compile-time width checks: if the generated interfaces drift, tsc --noEmit
// rejects these literals.
describe('interface numeric widths', () => {
  it('Slot carries number/bigint/U256 fields', () => {
    const q: U256__8JquwLopp8 = { hi: 0n, lo: 0n }
    const slot: Slot = {
      tick: -60,
      tick_spacing: 60,
      sqrt_price: { hi: 1n, lo: 0n },
      fee_protocol: 5,
      liquidity: 1000000n,
      fee_growth_global0_x_128: q,
      fee_growth_global1_x_128: q,
      max_liquidity_per_tick: 11505743598341114571880798222544994n,
      protocol_fees0: 0n,
      protocol_fees1: 0n,
      next_init_below: -887272,
      next_init_above: 887272,
    }
    expect(typeof slot.tick).toBe('number')
    expect(typeof slot.liquidity).toBe('bigint')
    expect(slot.sqrt_price).toEqual({ hi: 1n, lo: 0n })
  })

  it('PoolState has no scale fields; Position carries U256 fee growth', () => {
    const pool: PoolState = { token0: '11field', token1: '22field', fee: 3000, enabled: true }
    expect(typeof pool.fee).toBe('number')
    const pos: Position = {
      token_id: '42field',
      pool: '99field',
      tick_lower: -887272,
      tick_upper: 887272,
      liquidity: 500000n,
      fee_growth_inside0_last_x_128: { hi: 0n, lo: 0n },
      fee_growth_inside1_last_x_128: { hi: 0n, lo: 0n },
      tokens_owed0: 0n,
      tokens_owed1: 0n,
    }
    expect(pos.liquidity).toBe(500000n)
  })
})

// SwapComplianceRecord gained a `signer` field in the new stack.
describe('toSwapComplianceRecord', () => {
  it('decodes owner and string fields', () => {
    const record: RecordValue = {
      owner: ZERO,
      program: 'shield_swap.aleo',
      recordName: 'SwapComplianceRecord',
      nonce: '0group',
      entries: {
        swap_id: { value: '7field', visibility: 'private', type: { kind: 'primitive', primitive: 'field' } },
        token_in: { value: '11field', visibility: 'private', type: { kind: 'primitive', primitive: 'field' } },
        token_out: { value: '22field', visibility: 'private', type: { kind: 'primitive', primitive: 'field' } },
        request: { value: {}, visibility: 'private', type: { kind: 'struct', path: ['SwapRequest'], program: 'shield_swap.aleo' } },
        caller: { value: ZERO, visibility: 'private', type: { kind: 'primitive', primitive: 'address' } },
        signer: { value: ZERO, visibility: 'private', type: { kind: 'primitive', primitive: 'address' } },
        blinded_address: { value: ZERO, visibility: 'private', type: { kind: 'primitive', primitive: 'address' } },
      },
    }

    const compliance = toSwapComplianceRecord(record)
    expect(compliance.owner).toBe(ZERO)
    expect(compliance.swap_id).toBe('7field')
    expect(compliance.token_in).toBe('11field')
    expect(compliance._record).toBe(record)
  })
})
