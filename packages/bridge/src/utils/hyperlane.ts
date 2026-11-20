import bs58 from 'bs58'
import { getAddress, hexToBytes, isAddress, padHex } from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { HyperlaneAddressEncoding } from '../types/hyperlane.js'

/**
 * Validates canonical wallet-issued commitment bytes without accepting scalars or private state.
 * Checks the supplied object without contacting a wallet or network.
 * @param value Supplies an untrusted wallet response or saved address encoding.
 * @returns Nothing; narrows valid input to its public commitment object.
 * @throws BridgeError When extra fields or a noncanonical 32-byte hexadecimal commitment are present.
 * @example validateHyperlaneAddressEncoding({ commitmentHex: '11'.repeat(32) })
 */
export function validateHyperlaneAddressEncoding(value: unknown): asserts value is HyperlaneAddressEncoding {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('commitmentHex' in value)
    || typeof value.commitmentHex !== 'string' || !/^[0-9a-f]{64}$/.test(value.commitmentHex)) {
    throw new BridgeError('Hyperlane address encoding requires a canonical lowercase 32-byte commitmentHex without 0x')
  }
}

/**
 * Converts a wallet-issued commitment to the low and high Aleo u128 limbs.
 * Interprets each 16-byte half as little-endian without reversing wire bytes or contacting a network.
 * @param encoding Supplies canonical lowercase commitment hex without `0x`.
 * @returns Low limb followed by high limb, both unsigned 128-bit integers.
 * @throws BridgeError When the commitment is not exactly 32 canonical bytes.
 * @example const limbs = hyperlaneCommitmentToLimbs({ commitmentHex: '11'.repeat(32) })
 */
export function hyperlaneCommitmentToLimbs(encoding: HyperlaneAddressEncoding): readonly [bigint, bigint] {
  validateHyperlaneAddressEncoding(encoding)
  const bytes = hexToBytes(`0x${encoding.commitmentHex}`)
  return [littleEndianU128(bytes.slice(0, 16)), littleEndianU128(bytes.slice(16, 32))]
}

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
 * Validates a 20-byte EVM address, left-pads it to Hyperlane bytes32 form, and
 * interprets each 16-byte half as an Aleo `u128` without contacting either
 * chain.
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
 * Decodes a base58 account to its 32-byte public key and interprets each
 * 16-byte half as an Aleo `u128` without contacting either chain.
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
