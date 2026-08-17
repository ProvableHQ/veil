import { describe, expect, it } from 'vitest'
import { evmAddressToAleoHyperlaneRecipient } from '../../src/utils/hyperlane.js'

describe('Hyperlane wire utilities', () => {
  it('encodes a left-padded Ethereum address as two little-endian u128 limbs', () => {
    expect(evmAddressToAleoHyperlaneRecipient('0x1e196d0a7d8189054c4db744ab3340c3f1c68b19')).toEqual([
      13858749752514421660238621190289096704n,
      33956464229475118999063216025592496509n,
    ])
  })

  it('rejects malformed and non-20-byte destinations', () => {
    expect(() => evmAddressToAleoHyperlaneRecipient('0x1234')).toThrow(/Invalid Ethereum Hyperlane recipient/)
    expect(() => evmAddressToAleoHyperlaneRecipient(`0x${'11'.repeat(32)}`)).toThrow(/Invalid Ethereum Hyperlane recipient/)
  })
})
