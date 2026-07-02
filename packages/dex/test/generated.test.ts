import { describe, it, expect } from 'vitest'
import type { RecordValue } from '@veil/core'
import {
  PROGRAM_ID,
  toPositionNFT,
  toSwapComplianceRecord,
  type Slot,
  type PoolState,
  type Position,
} from '../src/generated/shield_swap.js'

// Verify the generated PROGRAM_ID constant matches the on-chain name.
describe('PROGRAM_ID', () => {
  it('equals the canonical program name', () => {
    expect(PROGRAM_ID).toBe('shield_swap_v0_0_2.aleo')
  })
})

// Build a minimal RecordValue that matches PositionNFT's field layout so
// toPositionNFT can decode it without touching the network.
describe('toPositionNFT', () => {
  const record: RecordValue = {
    owner: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
    program: 'shield_swap_v0_0_2.aleo',
    recordName: 'PositionNFT',
    nonce: '0group',
    fields: {
      token_id: {
        value: '1234field',
        mode: 'private',
        type: { kind: 'primitive', primitive: 'field' },
      },
      token0_id: {
        value: '11field',
        mode: 'private',
        type: { kind: 'primitive', primitive: 'field' },
      },
      token1_id: {
        value: '22field',
        mode: 'private',
        type: { kind: 'primitive', primitive: 'field' },
      },
      pool: {
        value: '99field',
        mode: 'private',
        type: { kind: 'primitive', primitive: 'field' },
      },
      tick_lower: {
        value: -887272n,
        mode: 'private',
        type: { kind: 'primitive', primitive: 'i32' },
      },
      tick_upper: {
        value: 887272n,
        mode: 'private',
        type: { kind: 'primitive', primitive: 'i32' },
      },
    },
  }

  it('decodes owner correctly', () => {
    const nft = toPositionNFT(record)
    expect(nft.owner).toBe('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')
  })

  it('decodes string fields as strings', () => {
    const nft = toPositionNFT(record)
    expect(nft.token_id).toBe('1234field')
    expect(nft.token0_id).toBe('11field')
    expect(nft.token1_id).toBe('22field')
    expect(nft.pool).toBe('99field')
    expect(typeof nft.token_id).toBe('string')
    expect(typeof nft.pool).toBe('string')
  })

  it('decodes i32 tick fields as JS numbers', () => {
    const nft = toPositionNFT(record)
    // tick_lower and tick_upper are i32 → number in the generated interface.
    expect(nft.tick_lower).toBe(-887272)
    expect(nft.tick_upper).toBe(887272)
    expect(typeof nft.tick_lower).toBe('number')
    expect(typeof nft.tick_upper).toBe('number')
  })

  it('attaches the raw RecordValue as _record', () => {
    const nft = toPositionNFT(record)
    expect(nft._record).toBe(record)
  })
})

// Verify the Slot interface carries the correct numeric widths.
// This is a compile-time check: if the interface is wrong the assertions below
// would fail to typecheck.  At runtime we satisfy the shape with a literal and
// assert each field's typeof.
describe('Slot interface numeric widths', () => {
  it('has number fields for i32/u32/u8 and bigint fields for u128', () => {
    // Construct a Slot literal — if field types drift from the interface,
    // TypeScript will reject this assignment during tsc --noEmit.
    const slot: Slot = {
      tick: -60,               // i32  → number
      tick_spacing: 60,        // u32  → number
      sqrt_price: 79228162514264337593543950336n, // u128 → bigint
      fee_protocol: 5,         // u8   → number
      liquidity: 1000000n,     // u128 → bigint
      fee_growth_global0_x_64: 0n,
      fee_growth_global1_x_64: 0n,
      fee_residual0_x_64: 0n,
      fee_residual1_x_64: 0n,
      max_liquidity_per_tick: 11505743598341114571880798222544994n,
      protocol_fees0: 0n,
      protocol_fees1: 0n,
      next_init_below: -887272, // i32 → number
      next_init_above: 887272,  // i32 → number
    }

    expect(typeof slot.tick).toBe('number')
    expect(typeof slot.tick_spacing).toBe('number')
    expect(typeof slot.fee_protocol).toBe('number')
    expect(typeof slot.next_init_below).toBe('number')
    expect(typeof slot.next_init_above).toBe('number')

    expect(typeof slot.sqrt_price).toBe('bigint')
    expect(typeof slot.liquidity).toBe('bigint')
    expect(typeof slot.fee_growth_global0_x_64).toBe('bigint')

    // Spot-check values survive round-trip through the literal.
    expect(slot.tick).toBe(-60)
    expect(slot.tick_spacing).toBe(60)
    expect(slot.sqrt_price).toBe(79228162514264337593543950336n)
    expect(slot.liquidity).toBe(1000000n)
  })
})

// Verify PoolState interface widths: fee is u16 → number, scales are u128 → bigint.
describe('PoolState interface numeric widths', () => {
  it('has number for fee and bigint for scale fields', () => {
    const pool: PoolState = {
      token0: '11field',
      token1: '22field',
      fee: 3000,         // u16 → number
      enabled: true,
      scale0: 1000000n,  // u128 → bigint
      scale1: 1000000n,
    }

    expect(typeof pool.fee).toBe('number')
    expect(typeof pool.scale0).toBe('bigint')
    expect(typeof pool.scale1).toBe('bigint')
    expect(pool.fee).toBe(3000)
    expect(pool.enabled).toBe(true)
  })
})

// Verify Position interface widths.
describe('Position interface numeric widths', () => {
  it('has number for i32 ticks and bigint for u128 amounts', () => {
    const pos: Position = {
      token_id: '42field',
      pool: '99field',
      tick_lower: -887272,  // i32 → number
      tick_upper: 887272,   // i32 → number
      liquidity: 500000n,   // u128 → bigint
      fee_growth_inside0_last_64: 0n,
      fee_growth_inside1_last_64: 0n,
      tokens_owed0: 0n,
      tokens_owed1: 0n,
    }

    expect(typeof pos.tick_lower).toBe('number')
    expect(typeof pos.tick_upper).toBe('number')
    expect(typeof pos.liquidity).toBe('bigint')
    expect(pos.tick_lower).toBe(-887272)
    expect(pos.tick_upper).toBe(887272)
    expect(pos.liquidity).toBe(500000n)
  })
})

// Smoke-test toSwapComplianceRecord with a minimal record.
describe('toSwapComplianceRecord', () => {
  it('decodes owner and string fields', () => {
    const owner = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
    const record: RecordValue = {
      owner,
      program: 'shield_swap_v0_0_2.aleo',
      recordName: 'SwapComplianceRecord',
      nonce: '0group',
      fields: {
        swap_id: {
          value: '7field',
          mode: 'private',
          type: { kind: 'primitive', primitive: 'field' },
        },
        token_in: {
          value: '11field',
          mode: 'private',
          type: { kind: 'primitive', primitive: 'field' },
        },
        token_out: {
          value: '22field',
          mode: 'private',
          type: { kind: 'primitive', primitive: 'field' },
        },
        request: {
          // Nested struct — the mapper casts via `as unknown as SwapRequest`.
          value: {},
          mode: 'private',
          type: { kind: 'struct', path: ['SwapRequest'], program: 'shield_swap_v0_0_2.aleo' },
        },
        caller: {
          value: owner,
          mode: 'private',
          type: { kind: 'primitive', primitive: 'address' },
        },
        blinded_address: {
          value: owner,
          mode: 'private',
          type: { kind: 'primitive', primitive: 'address' },
        },
      },
    }

    const compliance = toSwapComplianceRecord(record)
    expect(compliance.owner).toBe(owner)
    expect(compliance.swap_id).toBe('7field')
    expect(compliance.token_in).toBe('11field')
    expect(typeof compliance.swap_id).toBe('string')
    expect(compliance._record).toBe(record)
  })
})
