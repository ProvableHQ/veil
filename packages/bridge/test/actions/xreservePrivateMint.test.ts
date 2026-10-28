import { describe, expect, it, vi } from 'vitest'
import { complete as executeXReservePrivateMint } from '../../src/protocols/xreserve/evmToAleo.js'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createAleoClient } from '../../src/connections/aleo.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { AleoWalletClient, ExecuteXReservePrivateMintParameters } from '../../src/types/aleo.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'
import {
  buildXReserveHookData,
  aleoAddressToBytes32,
  aleoProgramAddress,
  calculateXReserveMessageHash,
} from '../../src/utils/xreserve.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const PAYLOAD = `0x${'00'.repeat(305)}` as const
const SIGNATURE = `0x${'11'.repeat(65)}` as const
const MESSAGE_HASH = calculateXReserveMessageHash(PAYLOAD)

async function walletMintFixture() {
  const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: 'sepolia', asset: 'usdc' },
    destination: { chain: 'aleo-testnet', asset: 'usdcx' },
    amount: '2', recipient: RECIPIENT, mintMode: 'private',
  })
  const commitment = '33'.repeat(32)
  const prepared = {
    remoteRecipientBytes32: aleoAddressToBytes32(await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'testnet')),
    hookData: `0x02${commitment}${'00'.repeat(32)}` as const,
  }
  const payload = `0x${'00'.repeat(240)}${prepared.hookData.slice(2)}` as const
  const messageHash = calculateXReserveMessageHash(payload)
  const deposit: BridgeReceipt = {
    id: messageHash, protocol: 'xreserve', status: 'ATTESTATION_PENDING',
    sourceTxId: `0x${'22'.repeat(32)}`,
    protocolState: { routeId: plan.route.id, mintMode: 'private', intendedRecipient: RECIPIENT, payload, messageHash },
  }
  const params: ExecuteXReservePrivateMintParameters = {
    plan, deposit, attestation: { status: 'complete', payload, messageHash, attestation: SIGNATURE },
    walletPreparedDeposit: prepared,
    privateMintNonceInput: {
      type: 'derived', algorithm: 'shielded-usdcx-secret-nonce',
      args: { commitment: { type: 'string', value: commitment }, recipient: { type: 'address', value: RECIPIENT } },
    },
  }
  return { params, commitment }
}

describe('xReserve private mint', () => {
  it('passes the AMM wallet-derived nonce unchanged to private_mint without exposing a scalar', async () => {
    const { params } = await walletMintFixture()
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1walletmint')
    const result = await executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, params)
    const call = executeTransaction.mock.calls[0]![0]
    expect(call).toMatchObject({ program: 'shielded_usdcx_wrapper.aleo', function: 'private_mint' })
    expect(call.inputs[3]).toBe(params.privateMintNonceInput)
    expect(call.inputs[4]).toBe(RECIPIENT)
    expect(result.receipt).toMatchObject({ status: 'DESTINATION_CONFIRMING', destinationTxId: 'at1walletmint' })
    expect(JSON.stringify(result.receipt)).not.toContain('secretNonce')
    expect(JSON.stringify(result.receipt)).not.toContain('privateMintNonceInput')
  })

  it.each(['progress', 'receipt'])('completes wallet preparations from %s without reading the local identity store', async (mode) => {
    const { params, commitment } = await walletMintFixture()
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1walletmint')
    const load = vi.fn(async () => { throw new Error('Wallet preparations must not load local secrets') })
    const bridge = createBridgeClient({
      environment: 'testnet',
      circle: { privateMintIdentities: { load, save: vi.fn() } },
      clients: { 'aleo-testnet': createAleoClient({ publicClient: {} as never, account: { executeTransaction } }) },
    })
    const checkpoint = vi.fn()
    const receipt: BridgeReceipt = {
      ...params.deposit, status: 'DESTINATION_ACTION_REQUIRED',
      nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
      protocolState: { ...params.deposit.protocolState, privateMintAddressCommitment: commitment, attestation: SIGNATURE },
    }
    const result = await bridge.complete({
      ...(mode === 'progress'
        ? { progress: { next: 'complete' as const, plan: params.plan, receipt } }
        : { plan: params.plan, receipt }),
      circle: {
        walletPreparedDeposit: params.walletPreparedDeposit,
        privateMintNonceInput: params.privateMintNonceInput,
      },
      onCheckpoint: checkpoint,
    })
    expect(result.kind).toBe('aleo-xreserve')
    expect(executeTransaction.mock.calls[0]![0].inputs[3]).toBe(params.privateMintNonceInput)
    expect(load).not.toHaveBeenCalled()
    expect(checkpoint).toHaveBeenCalledOnce()
    expect(JSON.stringify(checkpoint.mock.calls)).not.toContain('privateMintNonceInput')
  })

  it.each(['missing-input', 'literal', 'algorithm', 'commitment', 'recipient', 'argument-type', 'scalar', 'wrapper', 'attested-hook', 'no-preparation', 'local-account', 'wrong-account'])(
    'rejects a mismatched wallet mint (%s) before prompting the wallet', async (invalid) => {
      const { params } = await walletMintFixture()
      const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      const input = params.privateMintNonceInput
      if (typeof input !== 'object' || input.type !== 'derived') throw new Error('Expected derived fixture input')
      if (invalid === 'missing-input') params.privateMintNonceInput = undefined
      if (invalid === 'literal') params.privateMintNonceInput = '7scalar'
      if (invalid === 'algorithm') input.algorithm = 'program-scoped-blinding-factor'
      if (invalid === 'commitment') input.args.commitment!.value = '44'.repeat(32)
      if (invalid === 'recipient') input.args.recipient!.value = 'aleo1other'
      if (invalid === 'argument-type') input.args.commitment!.type = 'field'
      if (invalid === 'scalar') params.privateMintSecretNonce = '7scalar'
      if (invalid === 'wrapper') params.walletPreparedDeposit!.remoteRecipientBytes32 = `0x${'22'.repeat(32)}`
      if (invalid === 'attested-hook') {
        params.walletPreparedDeposit!.hookData = `0x02${'44'.repeat(32)}${'00'.repeat(32)}`
        input.args.commitment!.value = '44'.repeat(32)
      }
      if (invalid === 'no-preparation') params.walletPreparedDeposit = undefined
      const client = {
        executeTransaction,
        ...(invalid === 'local-account' ? { account: { type: 'local', address: RECIPIENT } } : {}),
        ...(invalid === 'wrong-account' ? { account: { type: 'rpc', address: 'aleo1other' } } : {}),
      } as AleoWalletClient
      await expect(executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, client, params)).rejects.toThrow(/wallet|attested hook/i)
      expect(executeTransaction).not.toHaveBeenCalled()
    },
  )

  it('submits only private_mint with the wrapper input order and plan scalar', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2',
      recipient: RECIPIENT,
      mintMode: 'private',
    })
    const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
    const payload = `0x${'00'.repeat(240)}${hookData.slice(2)}` as const
    const messageHash = calculateXReserveMessageHash(payload)
    const deposit: BridgeReceipt = {
      id: messageHash,
      protocol: 'xreserve',
      status: 'ATTESTATION_PENDING',
      sourceTxId: `0x${'22'.repeat(32)}`,
      protocolState: {
        routeId: plan.route.id,
        mintMode: 'private',
        intendedRecipient: RECIPIENT,
        payload,
        messageHash,
      },
    }
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1private')

    const result = await executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan,
      deposit,
      attestation: { status: 'complete', messageHash, payload, attestation: SIGNATURE },
      privateMintSecretNonce: '7scalar',
    })

    expect(executeTransaction).toHaveBeenCalledOnce()
    const call = executeTransaction.mock.calls[0]![0]
    expect(call.program).toBe('shielded_usdcx_wrapper.aleo')
    expect(call.function).toBe('private_mint')
    expect(call.inputs).toHaveLength(5)
    expect(call.inputs[3]).toBe('7scalar')
    expect(call.inputs[4]).toBe(RECIPIENT)
    expect(result.receipt.status).toBe('DESTINATION_CONFIRMING')
    expect(result.receipt.destinationTxId).toBe('at1private')
    expect(result.receipt.protocolState.secretNonce).toBeUndefined()
  })

  it('submits the locally stored scalar for a checkpointed address commitment', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2',
      recipient: RECIPIENT,
      mintMode: 'private',
    })
    const secretNonce = '7scalar'
    const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', secretNonce)
    const commitment = hookData.slice(4, 68)
    const payload = `0x${'00'.repeat(240)}${hookData.slice(2)}` as const
    const messageHash = calculateXReserveMessageHash(payload)
    const deposit: BridgeReceipt = {
      id: messageHash,
      protocol: 'xreserve',
      status: 'ATTESTATION_PENDING',
      sourceTxId: `0x${'22'.repeat(32)}`,
      protocolState: {
        routeId: plan.route.id,
        mintMode: 'private',
        intendedRecipient: RECIPIENT,
        privateMintAddressCommitment: commitment,
        payload,
        messageHash,
      },
    }
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1private')

    await executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan,
      deposit,
      attestation: { status: 'complete', messageHash, payload, attestation: SIGNATURE },
      privateMintSecretNonce: secretNonce,
    })

    expect(executeTransaction.mock.calls[0]![0].inputs[3]).toBe(secretNonce)
  })

  it('rejects public and record plans before prompting the wallet', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2',
      recipient: RECIPIENT,
      mintMode: 'record',
    })
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
    await expect(executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan,
      deposit: { id: MESSAGE_HASH, protocol: 'xreserve', status: 'ATTESTATION_PENDING', protocolState: {} },
      attestation: { status: 'complete', messageHash: MESSAGE_HASH, payload: PAYLOAD, attestation: SIGNATURE },
    })).rejects.toThrow(/private xReserve/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('rejects a secret nonce that does not reproduce the attested hook', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2',
      recipient: RECIPIENT,
      mintMode: 'private',
    })
    const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
    const payload = `0x${'00'.repeat(240)}${hookData.slice(2)}` as const
    const messageHash = calculateXReserveMessageHash(payload)
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()

    await expect(executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan,
      deposit: {
        id: messageHash,
        protocol: 'xreserve',
        status: 'ATTESTATION_PENDING',
        protocolState: {
          routeId: plan.route.id,
          mintMode: 'private',
          intendedRecipient: RECIPIENT,
          payload,
          messageHash,
        },
      },
      attestation: { status: 'complete', messageHash, payload, attestation: SIGNATURE },
      privateMintSecretNonce: '8scalar',
    })).rejects.toThrow(/do not match the attested hook/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })
})
