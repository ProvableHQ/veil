import { hexToBytes } from 'viem'
import { describe, expect, it } from 'vitest'
import shieldCoreVectors from '../fixtures/shield-core-private-mint.json'
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
  SHIELDED_USDCX_DOMAIN_MAINNET,
  SHIELDED_USDCX_DOMAIN_TESTNET,
  xReserveHexToAleoBytes,
  xReservePrivateMintCommitmentFromHookData,
  xReserveViewKeyToScalar,
} from '../../src/utils/xreserve.js'
import {
  findXReservePrivateMintIdentity,
  memoryXReservePrivateMintIdentityStore,
  reserveXReservePrivateMintIdentity,
  type XReservePrivateMintIdentity,
  type XReservePrivateMintIdentityStore,
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

  it.each(shieldCoreVectors.vectors)('matches shield-core master for $network counter $counter', async (vector) => {
    const network = vector.network as 'mainnet' | 'testnet'
    const viewKey = 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN'
    const viewKeyScalar = await xReserveViewKeyToScalar(viewKey, network)
    const secretNonce = await deriveXReservePrivateMintSecretNonce(viewKeyScalar, vector.counter, network)
    const commitment = await deriveXReservePrivateMintAddressCommitment(RECIPIENT, secretNonce, network)

    expect(secretNonce).toBe(vector.nonce)
    expect(commitment).toBe(vector.commitment)
    expect(await buildXReserveHookData('private', RECIPIENT, network, secretNonce))
      .toBe(buildXReservePrivateMintHookData(commitment))
  })

  it('pins network domains to Shield\'s little-endian ASCII labels', () => {
    const domain = (label: string) => `${BigInt(`0x${Buffer.from(label).reverse().toString('hex')}`)}field`
    expect(SHIELDED_USDCX_DOMAIN_MAINNET).toBe(domain('shielded_usdcx_mainnet'))
    expect(SHIELDED_USDCX_DOMAIN_TESTNET).toBe(domain('shielded_usdcx_testnet'))
    expect(SHIELDED_USDCX_DOMAIN_MAINNET).not.toBe(SHIELDED_USDCX_DOMAIN_TESTNET)
  })

  it.each([-1, 1.5, 0x1_0000_0000, Number.NaN])('rejects invalid u32 counters: %s', async (counter) => {
    await expect(deriveXReservePrivateMintSecretNonce('42scalar', counter, 'testnet'))
      .rejects.toThrow(/unsigned 32-bit/)
  })

  it.each([undefined, 'devnet', ''])('rejects unsupported derivation networks: %s', async (network) => {
    await expect(deriveXReservePrivateMintSecretNonce('42scalar', 0, network as 'testnet'))
      .rejects.toThrow(/Unsupported.*network/)
  })

  it('never recycles an allocation after failed derivation or identity persistence', async () => {
    const store = memoryXReservePrivateMintIdentityStore()
    const viewKeyScalar = await xReserveViewKeyToScalar(
      'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN', 'testnet',
    )
    const reserve = (recipient = RECIPIENT) => reserveXReservePrivateMintIdentity({
      store, viewKeyScalar, recipient, environment: 'testnet',
    })
    await expect(reserve('invalid')).rejects.toThrow(/commitment/)
    const save = store.save
    store.save = async () => { throw new Error('Storage write failed') }
    await expect(reserve()).rejects.toThrow('Storage write failed')
    store.save = save
    expect((await reserve()).counter).toBe(2)
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

  it.each([
    null,
    7,
    'identity',
    [],
    {},
    { counter: 0 },
  ])('rejects malformed stored identity records with BridgeError: %j', async (record) => {
    const store: XReservePrivateMintIdentityStore = {
      load: async () => [record as unknown as XReservePrivateMintIdentity],
      save: async () => {},
    }

    await expect(findXReservePrivateMintIdentity(store, 'ab'.repeat(32)))
      .rejects.toMatchObject({ name: 'BridgeError' })
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
