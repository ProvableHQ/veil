import { hexToBytes } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  aleoAddressToBytes32,
  buildXReserveDepositPayload,
  buildXReserveHookData,
  calculateXReserveDepositNonce,
  calculateXReserveMessageHash,
  xReserveHexToAleoBytes,
} from '../../src/utils/xreserve.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'

describe('xReserve wire utilities', () => {
  it('decodes Aleo bech32m addresses and rejects checksum changes', () => {
    expect(aleoAddressToBytes32(RECIPIENT)).toBe('0xb102e0d37e02ec5dbba2460287ac07ef7ea8ee636392ce235402308299901811')
    expect(() => aleoAddressToBytes32(`${RECIPIENT.slice(0, -1)}q`)).toThrow(/Invalid Aleo recipient/)
  })

  it('uses one-byte public and record selectors in fixed 65-byte hooks', async () => {
    const publicHook = await buildXReserveHookData('public', RECIPIENT, 'testnet')
    const recordHook = await buildXReserveHookData('record', RECIPIENT, 'testnet')
    expect(publicHook).toBe(`0x${'00'.repeat(65)}`)
    expect(recordHook).toBe(`0x01${'00'.repeat(64)}`)
  })

  it('builds and hashes the canonical 305-byte payload', async () => {
    const transactionHash = `0x${'12'.repeat(32)}` as const
    const nonce = calculateXReserveDepositNonce(0, transactionHash, 4)
    const payload = buildXReserveDepositPayload({
      amount: 1_000_000n,
      remoteDomain: 10002,
      remoteToken: '0xb143ed52c774cd1d4a519d0e796f15916be5a9e1d45edcd9852dd23f68f53401',
      remoteRecipient: aleoAddressToBytes32(RECIPIENT),
      localToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      depositor: '0x0000000000000000000000000000000000000001',
      maxFee: 100_000n,
      nonce,
      hookData: await buildXReserveHookData('public', RECIPIENT, 'testnet'),
    })
    expect(hexToBytes(payload)).toHaveLength(305)
    expect(payload.slice(0, 18)).toBe('0x5a2e0acd00000001')
    expect(calculateXReserveMessageHash(payload)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('formats fixed-width Aleo byte-array inputs', () => {
    expect(xReserveHexToAleoBytes('0x00ff', 2)).toBe('[0u8,255u8]')
    expect(() => xReserveHexToAleoBytes('0x00ff', 32)).toThrow(/32 bytes/)
  })
})
