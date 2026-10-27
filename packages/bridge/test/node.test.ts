import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileXReservePrivateMintIdentityStore } from '../src/node.js'
import { createBridgeClient } from '../src/clients/createBridgeClient.js'
import { createAleoClient } from '../src/connections/aleo.js'
import { prepare } from '../src/actions/prepare.js'
import {
  reserveXReservePrivateMintIdentity,
  type XReservePrivateMintIdentity,
} from '../src/utils/xreservePrivateMintStore.js'
import {
  aleoAddressToBytes32,
  aleoProgramAddress,
  buildXReserveDepositPayload,
  buildXReservePrivateMintHookData,
  calculateXReserveMessageHash,
  xReserveViewKeyToScalar,
} from '../src/utils/xreserve.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const VIEW_KEY = 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN'
const directories: string[] = []

async function temporaryStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aleo-bridge-private-mints-'))
  directories.push(directory)
  return join(directory, 'identities.json')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Node private-mint identity store', () => {
  it('replaces an existing permissive file with mode 0600', async () => {
    const path = await temporaryStorePath()
    await writeFile(path, '[]\n')
    await chmod(path, 0o644)
    const identity: XReservePrivateMintIdentity = {
      counter: 0,
      recipient: RECIPIENT,
      secretNonce: '7scalar',
      addressCommitment: 'ab'.repeat(32),
    }

    await fileXReservePrivateMintIdentityStore(path).save([identity])

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([identity])
  })

  it('serializes reservations across separate stores using the same file', async () => {
    const path = await temporaryStorePath()
    const firstStore = fileXReservePrivateMintIdentityStore(path)
    const secondStore = fileXReservePrivateMintIdentityStore(path)
    const viewKeyScalar = await xReserveViewKeyToScalar(VIEW_KEY, 'testnet')
    const reserve = (store: typeof firstStore) => reserveXReservePrivateMintIdentity({
      store,
      viewKeyScalar,
      recipient: RECIPIENT,
      environment: 'testnet',
    })

    const reserved = await Promise.all([reserve(firstStore), reserve(secondStore)])

    expect(reserved.map((identity) => identity.counter).sort()).toEqual([0, 1])
    expect((await firstStore.load()).map((identity) => identity.counter)).toEqual([0, 1])
    await expect(stat(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(`${path}.counter`, 'utf8'))).toBe(2)
    expect((await stat(`${path}.counter`)).mode & 0o777).toBe(0o600)
  })

  it('fails immediately when a regular file occupies the lock path', async () => {
    const path = await temporaryStorePath()
    await writeFile(`${path}.lock`, '')
    const store = fileXReservePrivateMintIdentityStore(path)

    await expect(reserveXReservePrivateMintIdentity({
      store,
      viewKeyScalar: await xReserveViewKeyToScalar(VIEW_KEY, 'testnet'),
      recipient: RECIPIENT,
      environment: 'testnet',
    })).rejects.toThrow(/is not a lock directory/)
    expect((await stat(`${path}.lock`)).isFile()).toBe(true)
  })

  it('retains consumed counters across restarts after derivation and persistence failures', async () => {
    const path = await temporaryStorePath()
    const viewKeyScalar = await xReserveViewKeyToScalar(VIEW_KEY, 'testnet')
    const reserve = (store: ReturnType<typeof fileXReservePrivateMintIdentityStore>, recipient = RECIPIENT) =>
      reserveXReservePrivateMintIdentity({ store, viewKeyScalar, recipient, environment: 'testnet' })
    await expect(reserve(fileXReservePrivateMintIdentityStore(path), 'invalid')).rejects.toThrow(/commitment/)
    const failingStore = fileXReservePrivateMintIdentityStore(path)
    failingStore.save = async () => { throw new Error('Storage write failed') }
    await expect(reserve(failingStore)).rejects.toThrow('Storage write failed')

    const identity = await reserve(fileXReservePrivateMintIdentityStore(path))
    expect(identity.counter).toBe(2)
    expect(JSON.parse(await readFile(`${path}.counter`, 'utf8'))).toBe(3)
  })

  it('fails closed when a persisted watermark is corrupt or exhausted', async () => {
    const path = await temporaryStorePath()
    const store = fileXReservePrivateMintIdentityStore(path)
    const viewKeyScalar = await xReserveViewKeyToScalar(VIEW_KEY, 'testnet')
    const reserve = () => reserveXReservePrivateMintIdentity({
      store, viewKeyScalar, recipient: RECIPIENT, environment: 'testnet',
    })
    await writeFile(`${path}.counter`, '"invalid"')
    await expect(reserve()).rejects.toThrow(/watermark is invalid/)
    await writeFile(`${path}.counter`, String(0x1_0000_0000))
    await expect(reserve()).rejects.toThrow(/exhausted/)
  })

  it('advances from existing identities when upgrading a store without a watermark', async () => {
    const path = await temporaryStorePath()
    const store = fileXReservePrivateMintIdentityStore(path)
    await store.save([{ counter: 7, recipient: RECIPIENT, secretNonce: '7scalar', addressCommitment: 'ab'.repeat(32) }])
    const identity = await reserveXReservePrivateMintIdentity({
      store,
      viewKeyScalar: await xReserveViewKeyToScalar(VIEW_KEY, 'testnet'),
      recipient: RECIPIENT,
      environment: 'testnet',
    })
    expect(identity.counter).toBe(8)
    expect(JSON.parse(await readFile(`${path}.counter`, 'utf8'))).toBe(9)
  })

  it('completes a derived private mint after restart without a Shield connection or supplied nonce', async () => {
    const path = await temporaryStorePath()
    const identity = await reserveXReservePrivateMintIdentity({
      store: fileXReservePrivateMintIdentityStore(path),
      viewKeyScalar: await xReserveViewKeyToScalar(VIEW_KEY, 'testnet'),
      recipient: RECIPIENT,
      environment: 'testnet',
    })
    const inputs: unknown[] = []
    const bridge = createBridgeClient({
      environment: 'testnet',
      privateMintIdentities: fileXReservePrivateMintIdentityStore(path),
      clients: {
        'aleo-testnet': createAleoClient({
          publicClient: {} as never,
          account: {
            executeTransaction: async (params) => {
              inputs.push(...params.inputs)
              return 'at1localmint'
            },
          },
        }),
      },
    })
    const plan = prepare(bridge.registry, {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2', recipient: RECIPIENT, mintMode: 'private',
    })
    const payload = buildXReserveDepositPayload({
      amount: 2_000_000n, remoteDomain: 10_002,
      remoteToken: `0x${'11'.repeat(32)}`,
      remoteRecipient: aleoAddressToBytes32(await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'testnet')),
      localToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      depositor: '0x0000000000000000000000000000000000000001',
      maxFee: 100_000n, nonce: `0x${'22'.repeat(32)}`,
      hookData: buildXReservePrivateMintHookData(identity.addressCommitment),
    })
    const messageHash = calculateXReserveMessageHash(payload)
    const checkpoints: unknown[] = []
    const result = await bridge.complete({
      plan,
      receipt: {
        id: messageHash, protocol: 'xreserve', status: 'DESTINATION_ACTION_REQUIRED',
        sourceTxId: `0x${'33'.repeat(32)}`,
        nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
        protocolState: {
          routeId: plan.route.id, payload, messageHash, attestation: `0x${'11'.repeat(65)}`,
          intendedRecipient: RECIPIENT, mintMode: 'private',
          privateMintAddressCommitment: identity.addressCommitment,
        },
      },
      onCheckpoint: (checkpoint) => { checkpoints.push(checkpoint) },
    })
    expect(result.receipt.destinationTxId).toBe('at1localmint')
    expect(inputs.slice(3)).toEqual([identity.secretNonce, RECIPIENT])
    expect(checkpoints).toEqual([expect.objectContaining({
      source: { transactionId: `0x${'33'.repeat(32)}`, privateMintAddressCommitment: identity.addressCommitment },
    })])
    expect(JSON.stringify(checkpoints)).not.toContain(identity.secretNonce)
  })
})
