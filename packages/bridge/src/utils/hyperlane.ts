import bs58 from 'bs58'
import { getAddress, hexToBytes, isAddress, padHex } from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'

function littleEndianU128(bytes: Uint8Array): bigint {
  let value = 0n
  for (let index = 0; index < bytes.length; index++) {
    value |= BigInt(bytes[index]!) << BigInt(index * 8)
  }
  return value
}

/**
 * Encodes an Ethereum account as the two little-endian limbs used by Aleo Warp Routes.
 *
 * Pure and local; validates a 20-byte EVM address, left-pads it to Hyperlane
 * bytes32 form, and interprets each 16-byte half as an Aleo `u128`.
 *
 * @param address Destination Ethereum account supplied by the transfer plan.
 * @returns Two unsigned 128-bit limbs in Hyperlane message order.
 * @throws BridgeError When the destination is not a valid 20-byte EVM address.
 *
 * @example
 * const recipient = evmAddressToAleoHyperlaneRecipient('0x1e196d0a7d8189054c4db744ab3340c3f1c68b19')
 */
export function evmAddressToAleoHyperlaneRecipient(address: string): readonly [bigint, bigint] {
  if (!isAddress(address)) throw new BridgeError(`Invalid Ethereum Hyperlane recipient: ${address}`)
  const recipient = hexToBytes(padHex(getAddress(address), { size: 32 }))
  return [
    littleEndianU128(recipient.slice(0, 16)),
    littleEndianU128(recipient.slice(16, 32)),
  ]
}

/**
 * Encodes a Solana account as the two little-endian limbs used by Aleo Warp Routes.
 *
 * Pure and local; decodes a base58 account to its 32-byte public key and
 * interprets each 16-byte half as an Aleo `u128`.
 *
 * @param address Destination Solana account supplied by the transfer plan.
 * @returns Two unsigned 128-bit limbs in Hyperlane message order.
 * @throws BridgeError When the destination is not a base58-encoded 32-byte account.
 *
 * @example
 * const recipient = solanaAddressToAleoHyperlaneRecipient('11111111111111111111111111111111')
 */
export function solanaAddressToAleoHyperlaneRecipient(address: string): readonly [bigint, bigint] {
  try {
    const recipient = bs58.decode(address)
    if (recipient.length !== 32) throw new Error('invalid public key width')
    return [
      littleEndianU128(recipient.slice(0, 16)),
      littleEndianU128(recipient.slice(16, 32)),
    ]
  } catch (cause) {
    throw new BridgeError(`Invalid Solana Hyperlane recipient: ${address}`, { cause })
  }
}
