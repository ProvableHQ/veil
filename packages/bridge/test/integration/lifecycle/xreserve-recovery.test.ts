import { describe, expect, it, vi } from 'vitest'
import { complete } from '../../../src/actions/complete.js'
import { getStatus } from '../../../src/actions/getStatus.js'
import { wait } from '../../../src/actions/wait.js'
import { recover } from '../../../src/actions/recover.js'
import { createAleoClient } from '../../../src/connections/aleo.js'
import { prepare } from '../../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../../src/registry/default.js'
import type { AleoWalletClient } from '../../../src/types/aleo.js'
import type { BridgeReceipt } from '../../../src/types/protocol.js'
import { buildXReserveDepositPayload, buildXReserveHookData, calculateXReserveMessageHash } from '../../../src/utils/xreserve.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const SIGNATURE = `0x${'11'.repeat(65)}` as const

async function fixture() {
  const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: 'sepolia', asset: 'usdc' },
    destination: { chain: 'aleo-testnet', asset: 'usdcx' },
    amount: '2',
    recipient: RECIPIENT,
    mintMode: 'private',
  })
  const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
  const payload = buildXReserveDepositPayload({
    amount: 2_000_000n,
    remoteDomain: 10_002,
    remoteToken: `0x${'11'.repeat(32)}`,
    remoteRecipient: `0x${'22'.repeat(32)}`,
    localToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    depositor: '0x0000000000000000000000000000000000000001',
    maxFee: 100_000n,
    nonce: `0x${'00'.repeat(32)}`,
    hookData,
  })
  const messageHash = calculateXReserveMessageHash(payload)
  const receipt: BridgeReceipt = {
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
  return { plan, payload, messageHash, receipt }
}

describe('xReserve lifecycle', () => {
  it('recognizes an already-minted inbound deposit before asking the caller to complete it', async () => {
    const { plan, receipt } = await fixture()
    const request = vi.fn(async () => 'true')
    const awaitingPrivateMint: BridgeReceipt = {
      ...receipt,
      status: 'DESTINATION_ACTION_REQUIRED',
      nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
      protocolState: {
        ...receipt.protocolState,
        bridgeProgram: 'test_usdcx_bridge_v2.aleo',
        nonce: `0x${'33'.repeat(32)}`,
        attestation: SIGNATURE,
      },
    }

    const result = await getStatus(
      DEFAULT_BRIDGE_REGISTRY,
      { 'aleo-testnet': createAleoClient({ publicClient: { request } as never }) },
      vi.fn(),
      { plan, receipt: awaitingPrivateMint },
    )

    expect(result).toMatchObject({ status: 'COMPLETED' })
    expect(result.nextAction).toBeUndefined()
    expect(request).toHaveBeenCalledWith({
      method: 'getMappingValue',
      params: {
        programId: 'test_usdcx_bridge_v2.aleo',
        mapping: 'nullifier',
        key: `[${Array.from({ length: 32 }, () => '51u8').join(',')}]`,
      },
    })
  })

  it('recovers the delivery nonce from the attested payload when older progress omitted it', async () => {
    const { plan, receipt, payload } = await fixture()
    const request = vi.fn(async () => 'true')
    const legacyReceipt: BridgeReceipt = {
      ...receipt,
      status: 'DELIVERY_PENDING',
      protocolState: {
        ...receipt.protocolState,
        payload,
        bridgeProgram: 'test_usdcx_bridge_v2.aleo',
      },
    }

    const result = await getStatus(
      DEFAULT_BRIDGE_REGISTRY,
      { 'aleo-testnet': createAleoClient({ publicClient: { request } as never }) },
      vi.fn(),
      { plan, receipt: legacyReceipt },
    )

    expect(result.status).toBe('COMPLETED')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        mapping: 'nullifier',
        key: `[${Array.from({ length: 32 }, () => '0u8').join(',')}]`,
      }),
    }))
  })

  it('turns a verified Circle attestation into a destination action', async () => {
    const { plan, payload, messageHash, receipt } = await fixture()
    const result = await getStatus(
      DEFAULT_BRIDGE_REGISTRY,
      {},
      async () => ({ ok: true, status: 200, json: async () => ({ attestation: { payload, messageHash, attestation: SIGNATURE } }) }),
      { plan, receipt },
    )

    expect(result).toMatchObject({
      status: 'DESTINATION_ACTION_REQUIRED',
      nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
      protocolState: { attestation: SIGNATURE },
    })
  })

  it('completes a ready private mint through the native Veil wallet capability', async () => {
    const { plan, payload, messageHash, receipt } = await fixture()
    const transaction = { type: 'execute', id: 'at1private', fee: {} } as never
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>(async (params) => {
      await params.onProgress?.({ type: 'transaction-prepared', transactionId: 'at1private', transaction })
      return 'at1private'
    })
    const ready: BridgeReceipt = {
      ...receipt,
      status: 'DESTINATION_ACTION_REQUIRED',
      nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
      protocolState: { ...receipt.protocolState, attestation: SIGNATURE },
    }
    const checkpoints: unknown[] = []
    const result = await complete(
      DEFAULT_BRIDGE_REGISTRY,
      { 'aleo-testnet': createAleoClient({ publicClient: {} as never, account: { executeTransaction } }) },
      {
        progress: { next: 'complete', plan, receipt: ready },
        privateMintSecretNonce: '7scalar',
        onCheckpoint(value) { checkpoints.push(value) },
      },
    )

    expect(result.kind).toBe('aleo-xreserve')
    expect(executeTransaction).toHaveBeenCalledOnce()
    expect(result.receipt).toMatchObject({ status: 'DESTINATION_CONFIRMING', destinationTxId: 'at1private' })
    expect(result.receipt.nextAction).toBeUndefined()
    expect(checkpoints).toEqual([{
      version: 1,
      intent: {
        source: { chain: 'sepolia', asset: 'usdc' },
        destination: { chain: 'aleo-testnet', asset: 'usdcx' },
        bridgeProtocol: 'xreserve',
        amount: '2',
        recipient: RECIPIENT,
        mintMode: 'private',
      },
      route: { id: plan.route.id, registryVersion: plan.registryVersion },
      source: { transactionId: receipt.sourceTxId },
      destination: {
        preparedTransaction: {
          transactionId: 'at1private',
          serializedTransaction: JSON.stringify(transaction),
        },
      },
    }, {
      version: 1,
      intent: {
        source: { chain: 'sepolia', asset: 'usdc' },
        destination: { chain: 'aleo-testnet', asset: 'usdcx' },
        bridgeProtocol: 'xreserve',
        amount: '2',
        recipient: RECIPIENT,
        mintMode: 'private',
      },
      route: { id: plan.route.id, registryVersion: plan.registryVersion },
      source: { transactionId: receipt.sourceTxId },
      destination: { transactionId: 'at1private' },
    }])
    expect(result.receipt.protocolState).toMatchObject({ payload, messageHash })
  })

  it('broadcasts an identical prepared destination transaction without prompting the wallet again', async () => {
    const { plan, payload, messageHash, receipt } = await fixture()
    const transaction = { type: 'execute', id: 'at1private', fee: {} }
    const request = vi.fn(async () => 'at1private')
    const ready: BridgeReceipt = {
      ...receipt,
      id: 'at1private',
      status: 'DESTINATION_ACTION_REQUIRED',
      nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
      protocolState: {
        ...receipt.protocolState,
        attestation: SIGNATURE,
        preparedDestinationTransaction: JSON.stringify(transaction),
      },
    }

    const result = await complete(
      DEFAULT_BRIDGE_REGISTRY,
      { 'aleo-testnet': createAleoClient({ publicClient: { request } as never }) },
      { progress: { next: 'complete', plan, receipt: ready } },
    )

    expect(request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(transaction) },
    })
    expect(result.receipt).toMatchObject({
      status: 'DESTINATION_CONFIRMING',
      destinationTxId: 'at1private',
      protocolState: { payload, messageHash },
    })
  })

  it('lets wait stop at an explicitly requested protocol status', async () => {
    const { plan, payload, messageHash, receipt } = await fixture()
    let reads = 0
    const updates: unknown[] = []
    const result = await wait(
      DEFAULT_BRIDGE_REGISTRY,
      {},
      async () => {
        reads++
        return reads === 1
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ attestation: { payload, messageHash, attestation: SIGNATURE } }) }
      },
      {
        progress: { next: 'wait', plan, receipt },
        until: ['DESTINATION_ACTION_REQUIRED'],
        pollingIntervalMs: 0,
        timeoutMs: 1_000,
        onUpdate(value) { updates.push(value) },
      },
    )

    expect(reads).toBe(2)
    expect(result).toMatchObject({
      next: 'complete',
      receipt: { status: 'DESTINATION_ACTION_REQUIRED' },
    })
    expect(updates).toEqual([result])
  })

  it('waits from recovered progress and returns the next caller operation', async () => {
    const { plan, payload, messageHash, receipt } = await fixture()
    const result = await wait(
      DEFAULT_BRIDGE_REGISTRY,
      {},
      async () => ({ ok: true, status: 200, json: async () => ({ attestation: { payload, messageHash, attestation: SIGNATURE } }) }),
      {
        progress: { next: 'wait', plan, receipt },
        pollingIntervalMs: 0,
        timeoutMs: 1_000,
      },
    )

    expect(result).toMatchObject({
      next: 'complete',
      receipt: { status: 'DESTINATION_ACTION_REQUIRED' },
    })
  })

  it('rejects an empty explicit status list before returning current progress', async () => {
    const { plan, receipt } = await fixture()

    await expect(wait(
      DEFAULT_BRIDGE_REGISTRY,
      {},
      vi.fn(),
      {
        progress: { next: 'wait', plan, receipt },
        until: [],
      },
    )).rejects.toThrow('wait requires at least one target status')
  })

  it.each([
    ['accepted', 'COMPLETED'],
    ['rejected', 'FAILED'],
  ] as const)('maps an Aleo %s transaction to %s', async (aleoStatus, bridgeStatus) => {
    const { plan, receipt } = await fixture()
    const confirming: BridgeReceipt = {
      ...receipt,
      status: 'DESTINATION_CONFIRMING',
      destinationTxId: 'at1private',
      protocolState: { ...receipt.protocolState, attestation: SIGNATURE },
    }
    const publicClient = {
      account: { type: 'rpc' },
      request: vi.fn(async () => ({
        status: aleoStatus,
        transactionId: 'at1private',
        ...(aleoStatus === 'rejected' ? { error: 'execution rejected' } : {}),
      })),
    } as never
    const result = await getStatus(
      DEFAULT_BRIDGE_REGISTRY,
      { 'aleo-testnet': createAleoClient({ publicClient }) },
      vi.fn(),
      { plan, receipt: confirming },
    )

    expect(result.status).toBe(bridgeStatus)
    if (aleoStatus === 'rejected') expect(result.protocolState.destinationError).toBe('execution rejected')
  })

  it('advances an accepted Aleo burn to relayer delivery', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo-testnet', asset: 'usdcx' },
      destination: { chain: 'sepolia', asset: 'usdc' },
      amount: '2.1',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    const receipt: BridgeReceipt = {
      id: 'at1burn',
      protocol: 'xreserve',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: 'at1burn',
      protocolState: { routeId: plan.route.id },
    }
    const publicClient = {
      account: { type: 'rpc' },
      request: vi.fn(async () => ({ status: 'accepted', transactionId: 'at1burn' })),
    } as never

    const result = await getStatus(
      DEFAULT_BRIDGE_REGISTRY,
      { 'aleo-testnet': createAleoClient({ publicClient }) },
      vi.fn(),
      { plan, receipt },
    )

    expect(result).toMatchObject({ status: 'DELIVERY_PENDING', sourceTxId: 'at1burn' })
  })

  it('recovers an Aleo burn from its compact source checkpoint', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo-testnet', asset: 'usdcx' },
      destination: { chain: 'sepolia', asset: 'usdc' },
      amount: '2.1',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    const publicClient = {
      account: { type: 'rpc' },
      request: vi.fn(async () => ({ status: 'accepted', transactionId: 'at1burn' })),
    } as never

    const result = await recover(
      DEFAULT_BRIDGE_REGISTRY,
      { 'aleo-testnet': createAleoClient({ publicClient }) },
      vi.fn(),
      {
        checkpoint: {
          version: 1,
          intent: {
            source: { chain: 'aleo-testnet', asset: 'usdcx' },
            destination: { chain: 'sepolia', asset: 'usdc' },
            bridgeProtocol: 'xreserve',
            amount: '2.1',
            recipient: '0x0000000000000000000000000000000000000001',
          },
          route: { id: plan.route.id, registryVersion: plan.registryVersion },
          source: { transactionId: 'at1burn' },
        },
      },
    )

    expect(result).toMatchObject({
      next: 'wait',
      receipt: { status: 'DELIVERY_PENDING', sourceTxId: 'at1burn' },
      plan: { route: { id: plan.route.id } },
    })
  })
})
