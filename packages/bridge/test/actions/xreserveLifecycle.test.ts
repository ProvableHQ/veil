import { describe, expect, it, vi } from 'vitest'
import { complete } from '../../src/actions/complete.js'
import { getStatus } from '../../src/actions/getStatus.js'
import { waitForStatus } from '../../src/actions/waitForStatus.js'
import { wait } from '../../src/actions/wait.js'
import { recover } from '../../src/actions/recover.js'
import { createAleoClient } from '../../src/connections/aleo.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { AleoWalletClient } from '../../src/types/aleo.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'
import { buildXReserveHookData, calculateXReserveMessageHash } from '../../src/utils/xreserve.js'

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
  const payload = `0x${'00'.repeat(240)}${hookData.slice(2)}` as const
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
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1private')
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
      destination: { transactionId: 'at1private' },
    }])
    expect(result.receipt.protocolState).toMatchObject({ payload, messageHash })
  })

  it('waits through read-only pending responses until the requested status', async () => {
    const { plan, payload, messageHash, receipt } = await fixture()
    let reads = 0
    const updates: BridgeReceipt[] = []
    const result = await waitForStatus(
      DEFAULT_BRIDGE_REGISTRY,
      {},
      async () => {
        reads++
        return reads === 1
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ attestation: { payload, messageHash, attestation: SIGNATURE } }) }
      },
      {
        plan,
        receipt,
        until: ['DESTINATION_ACTION_REQUIRED'],
        pollingIntervalMs: 0,
        timeoutMs: 1_000,
        onUpdate(value) { updates.push(value) },
      },
    )

    expect(reads).toBe(2)
    expect(result.status).toBe('DESTINATION_ACTION_REQUIRED')
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
