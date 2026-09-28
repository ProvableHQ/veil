import { hexToBytes } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  aleoAddressToBytes32,
  aleoProgramAddress,
  bytes32ToAleoAddress,
  buildXReserveDepositPayload,
  buildXReserveHookData,
  buildXReservePrivateMintHookData,
  calculateXReserveDepositNonce,
  calculateXReserveMessageHash,
  deriveXReservePrivateMintAddressCommitment,
  deriveXReservePrivateMintSecretNonce,
  evmAddressToXReserveBytes32,
  xReserveHexToAleoBytes,
  xReservePrivateMintCommitmentFromHookData,
  xReserveViewKeyToScalar,
} from '../../src/utils/xreserve.js'
import {
  memoryXReservePrivateMintIdentityStore,
  reserveXReservePrivateMintIdentity,
} from '../../src/utils/xreservePrivateMintStore.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'

describe('xReserve wire utilities', () => {
  it('decodes Aleo bech32m addresses and rejects checksum changes', () => {
    expect(aleoAddressToBytes32(RECIPIENT)).toBe('0xb102e0d37e02ec5dbba2460287ac07ef7ea8ee636392ce235402308299901811')
    expect(bytes32ToAleoAddress(aleoAddressToBytes32(RECIPIENT))).toBe(RECIPIENT)
    expect(() => aleoAddressToBytes32(`${RECIPIENT.slice(0, -1)}q`)).toThrow(/Invalid Aleo recipient/)
    expect(() => bytes32ToAleoAddress('0x01')).toThrow(/32-byte Aleo recipient/)
  })

  it('encodes the shielded USDCx wrapper exactly as Circle attests it', async () => {
    const wrapper = await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'testnet')
    expect(aleoAddressToBytes32(wrapper))
      .toBe('0x3c47112203a792e5a2d46f059016c06d83bdad32ada95d15ad66e2bc26f7fc0b')
  })

  it('uses one-byte public and record selectors in fixed 65-byte hooks', async () => {
    const publicHook = await buildXReserveHookData('public', RECIPIENT, 'testnet')
    const recordHook = await buildXReserveHookData('record', RECIPIENT, 'testnet')
    expect(publicHook).toBe(`0x${'00'.repeat(65)}`)
    expect(recordHook).toBe(`0x01${'00'.repeat(64)}`)
  })

  it('uses the selected scalar for private recipient commitments', async () => {
    const defaultHook = await buildXReserveHookData('private', RECIPIENT, 'testnet')
    const explicitZeroHook = await buildXReserveHookData('private', RECIPIENT, 'testnet', '0scalar')
    const customHook = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
    expect(hexToBytes(defaultHook)).toHaveLength(65)
    expect(defaultHook.startsWith('0x02')).toBe(true)
    expect(defaultHook).toBe(explicitZeroHook)
    expect(customHook.startsWith('0x02')).toBe(true)
    expect(customHook).not.toBe(defaultHook)
    expect(customHook).toBe(
      `0x0264689b7f6aedabd7dd529f50639ddb1d27dd405932f14a33a5d1986e5f0c3b12${'00'.repeat(32)}`,
    )
  })

  it('encodes private-mint commitments without exposing the private scalar', () => {
    const commitment = '3c47112203a792e5a2d46f059016c06d83bdad32ada95d15ad66e2bc26f7fc0b'
    const hook = buildXReservePrivateMintHookData(commitment)

    expect(hook).toBe(`0x02${commitment}${'00'.repeat(32)}`)
    expect(xReservePrivateMintCommitmentFromHookData(hook)).toBe(commitment)
    expect(() => buildXReservePrivateMintHookData(commitment.toUpperCase())).toThrow(/lowercase hex/)
    expect(() => xReservePrivateMintCommitmentFromHookData(`0x02${commitment}${'01'.repeat(32)}`))
      .toThrow(/canonical private mint commitment/)
  })

  it('derives the Shield-compatible scalar and commitment locally from a counter', async () => {
    const viewKey = 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN'
    const viewKeyScalar = await xReserveViewKeyToScalar(viewKey, 'testnet')
    const secretNonce = await deriveXReservePrivateMintSecretNonce(viewKeyScalar, 0, 'testnet')
    const commitment = await deriveXReservePrivateMintAddressCommitment(RECIPIENT, secretNonce, 'testnet')

    expect(secretNonce).toBe(
      '759048307583563651306472865962102220302349709738148140987801089381236393352scalar',
    )
    expect(commitment).toBe('31698f7afad09821157df054368ae01c7966a189a9f672148d8eadd56b442f0b')
    expect(await buildXReserveHookData('private', RECIPIENT, 'testnet', secretNonce))
      .toBe(buildXReservePrivateMintHookData(commitment))
  })

  it('persists distinct counters before concurrent private-mint reservations return', async () => {
    const store = memoryXReservePrivateMintIdentityStore()
    const viewKeyScalar = await xReserveViewKeyToScalar(
      'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN',
      'testnet',
    )
    const reserve = () => reserveXReservePrivateMintIdentity({
      store,
      viewKeyScalar,
      recipient: RECIPIENT,
      environment: 'testnet',
    })

    const identities = await Promise.all([reserve(), reserve()])

    expect(identities.map((identity) => identity.counter)).toEqual([0, 1])
    expect(new Set(identities.map((identity) => identity.addressCommitment)).size).toBe(2)
    expect(await store.load()).toEqual(identities)
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

  it('left-pads an Ethereum burn recipient to 32 bytes', () => {
    expect(evmAddressToXReserveBytes32('0x0000000000000000000000000000000000000001'))
      .toBe(`0x${'00'.repeat(31)}01`)
  })
})
