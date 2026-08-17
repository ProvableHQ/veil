import { describe, expect, it } from 'vitest'
import {
  evmAddressToAleoHyperlaneRecipient,
  solanaAddressToAleoHyperlaneRecipient,
} from '../../src/utils/hyperlane.js'

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

  it('decodes a Solana account as two little-endian u128 limbs', () => {
    expect(solanaAddressToAleoHyperlaneRecipient('8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7')).toEqual([
      127878782877948140186055645953777992816n,
      163261512394675613100746600600636171918n,
    ])
    expect(solanaAddressToAleoHyperlaneRecipient('11111111111111111111111111111111')).toEqual([0n, 0n])
  })

  it('rejects malformed and wrong-width Solana destinations', () => {
    expect(() => solanaAddressToAleoHyperlaneRecipient('not-base58!')).toThrow(/Invalid Solana Hyperlane recipient/)
    expect(() => solanaAddressToAleoHyperlaneRecipient('1111')).toThrow(/Invalid Solana Hyperlane recipient/)
  })
})
