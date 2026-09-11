import { describe, expect, it, vi } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const APPROVAL_TX_ID = `0x${'11'.repeat(32)}`
const SOURCE_TX_ID = `0x${'22'.repeat(32)}`
const DESTINATION_TX_ID = 'at1destination'

function plan() {
  return prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: 'sepolia', asset: 'usdc' },
    destination: { chain: 'aleo-testnet', asset: 'usdcx' },
    amount: '2',
    recipient: RECIPIENT,
    mintMode: 'private',
  })
}

describe('bridge recovery checkpoints', () => {
  it('exposes recover as a protocol-neutral client action', () => {
    const client = createBridgeClient()
    expect(client.recover).toBeTypeOf('function')
    expect(client.resume).toBeTypeOf('function')
    expect(client.wait).toBeTypeOf('function')
  })

  it('persists the public transfer intent with transaction identifiers', () => {
    const transferPlan = plan()
    const receipt: BridgeReceipt = {
      id: DESTINATION_TX_ID,
      protocol: 'xreserve',
      status: 'DESTINATION_CONFIRMING',
      sourceTxId: SOURCE_TX_ID,
      destinationTxId: DESTINATION_TX_ID,
      protocolState: {
        routeId: transferPlan.route.id,
        approvalTxIds: [APPROVAL_TX_ID],
        payload: 'large protocol data must not be persisted',
      },
    }

    expect(createBridgeCheckpoint(transferPlan, receipt)).toEqual({
      version: 1,
      intent: {
        source: { chain: 'sepolia', asset: 'usdc' },
        destination: { chain: 'aleo-testnet', asset: 'usdcx' },
        bridgeProtocol: 'xreserve',
        amount: '2',
        recipient: RECIPIENT,
        mintMode: 'private',
      },
      route: {
        id: transferPlan.route.id,
        registryVersion: transferPlan.registryVersion,
      },
      source: {
        approvalTransactionIds: [APPROVAL_TX_ID],
        transactionId: SOURCE_TX_ID,
      },
      destination: { transactionId: DESTINATION_TX_ID },
    })
  })

  it('rejects receipts that do not belong to the prepared route', () => {
    const transferPlan = plan()
    const receipt: BridgeReceipt = {
      id: SOURCE_TX_ID,
      protocol: 'xreserve',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: SOURCE_TX_ID,
      protocolState: { routeId: 'xreserve:wrong/route' },
    }

    expect(() => createBridgeCheckpoint(transferPlan, receipt)).toThrow(/does not match/)
  })

  it('recovers a prepared Aleo transaction without treating it as submitted', async () => {
    const request = vi.fn()
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: { aleo: { family: 'aleo', publicClient: { request } as never } },
    })
    const transferPlan = bridge.prepare({
      source: { chain: 'aleo', asset: 'eth' },
      destination: { chain: 'ethereum', asset: 'eth' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000000000000001',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    const serializedTransaction = JSON.stringify({ type: 'execute', id: 'at1prepared', fee: {} })

    const progress = await bridge.recover({
      checkpoint: {
        version: 1,
        intent: {
          source: { chain: 'aleo', asset: 'eth' },
          destination: { chain: 'ethereum', asset: 'eth' },
          bridgeProtocol: 'hyperlane',
          amount: transferPlan.amountIn,
          recipient: transferPlan.recipient,
        },
        route: { id: transferPlan.route.id, registryVersion: transferPlan.registryVersion },
        source: {
          preparedTransaction: { transactionId: 'at1prepared', serializedTransaction },
        },
      },
    })

    expect(progress).toMatchObject({
      next: 'resume',
      receipt: { status: 'SOURCE_SUBMISSION_PENDING', id: 'at1prepared' },
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('resumes a prepared Aleo transaction by broadcasting the identical bytes once', async () => {
    const request = vi.fn(async () => 'at1prepared')
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: { aleo: { family: 'aleo', publicClient: { request } as never } },
    })
    const transferPlan = bridge.prepare({
      source: { chain: 'aleo', asset: 'eth' },
      destination: { chain: 'ethereum', asset: 'eth' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000000000000001',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    const serializedTransaction = JSON.stringify({ type: 'execute', id: 'at1prepared', fee: {} })
    const progress = {
      next: 'resume' as const,
      plan: transferPlan,
      receipt: {
        id: 'at1prepared',
        protocol: 'hyperlane' as const,
        status: 'SOURCE_SUBMISSION_PENDING' as const,
        protocolState: { routeId: transferPlan.route.id, preparedTransaction: serializedTransaction },
      },
    }
    const checkpoints: unknown[] = []

    const result = await bridge.resume({
      progress,
      onCheckpoint(checkpoint) { checkpoints.push(checkpoint) },
    })

    expect(request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: serializedTransaction },
    })
    expect(result).toMatchObject({
      kind: 'aleo-hyperlane',
      transactionId: 'at1prepared',
      receipt: { status: 'SOURCE_CONFIRMING', sourceTxId: 'at1prepared' },
    })
    expect(checkpoints).toHaveLength(1)
  })

  it('checkpoints a proved Aleo transaction before the wallet broadcasts it', async () => {
    const transaction = { type: 'execute', id: 'at1prepared', fee: {} } as never
    const executeTransaction = vi.fn(async (params: {
      onProgress?: (event: unknown) => void | Promise<void>
    }) => {
      await params.onProgress?.({ type: 'transaction-prepared', transactionId: 'at1prepared', transaction })
      await params.onProgress?.({ type: 'transaction-submitted', transactionId: 'at1prepared' })
      return 'at1prepared'
    })
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        aleo: {
          family: 'aleo',
          publicClient: {} as never,
          walletClient: { executeTransaction } as never,
        },
      },
    })
    const transferPlan = bridge.prepare({
      source: { chain: 'aleo', asset: 'eth' },
      destination: { chain: 'ethereum', asset: 'eth' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000000000000001',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    const checkpoints: any[] = []

    await bridge.execute({
      plan: transferPlan,
      gasPaymentMicrocredits: 1n,
      onCheckpoint(checkpoint) { checkpoints.push(checkpoint) },
    })

    expect(checkpoints[0]?.source).toEqual({
      preparedTransaction: {
        transactionId: 'at1prepared',
        serializedTransaction: JSON.stringify(transaction),
      },
    })
    expect(checkpoints[1]?.source).toEqual({ transactionId: 'at1prepared' })
  })

  it('completes Aleo-origin Hyperlane delivery from the destination balance', async () => {
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        solana: {
          family: 'solana',
          publicClient: { getBalance: vi.fn(async () => 101n) } as never,
        },
      },
    })
    const transferPlan = bridge.prepare({
      source: { chain: 'aleo', asset: 'sol' },
      destination: { chain: 'solana', asset: 'sol' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000001',
      recipient: '11111111111111111111111111111111',
    })

    const result = await bridge.getStatus({
      plan: transferPlan,
      receipt: {
        id: 'at1source',
        protocol: 'hyperlane',
        status: 'DELIVERY_PENDING',
        sourceTxId: 'at1source',
        protocolState: {
          routeId: transferPlan.route.id,
          destinationBalanceBeforeAtomic: '100',
          expectedDestinationIncreaseAtomic: '1',
        },
      },
    })

    expect(result.status).toBe('COMPLETED')
  })

  it('waits through Aleo-origin Hyperlane delivery instead of returning the pending handoff', async () => {
    let reads = 0
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        solana: {
          family: 'solana',
          publicClient: {
            getBalance: vi.fn(async () => ++reads === 1 ? 100n : 101n),
          } as never,
        },
      },
    })
    const transferPlan = bridge.prepare({
      source: { chain: 'aleo', asset: 'sol' },
      destination: { chain: 'solana', asset: 'sol' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000001',
      recipient: '11111111111111111111111111111111',
    })

    const result = await bridge.wait({
      progress: {
        next: 'wait',
        plan: transferPlan,
        receipt: {
          id: 'at1source',
          protocol: 'hyperlane',
          status: 'DELIVERY_PENDING',
          sourceTxId: 'at1source',
          protocolState: {
            routeId: transferPlan.route.id,
            destinationBalanceBeforeAtomic: '100',
            expectedDestinationIncreaseAtomic: '1',
          },
        },
      },
      pollingIntervalMs: 0,
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({ next: 'done', receipt: { status: 'COMPLETED' } })
  })

  it('captures destination balance verification before Aleo Hyperlane submission', async () => {
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        aleo: {
          family: 'aleo',
          publicClient: {} as never,
          walletClient: { executeTransaction: vi.fn(async () => 'at1source') },
        },
        solana: {
          family: 'solana',
          publicClient: { getBalance: vi.fn(async () => 100n) } as never,
        },
      },
    })
    const transferPlan = bridge.prepare({
      source: { chain: 'aleo', asset: 'sol' },
      destination: { chain: 'solana', asset: 'sol' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000001',
      recipient: '11111111111111111111111111111111',
    })
    const checkpoints: any[] = []

    const result = await bridge.execute({
      plan: transferPlan,
      gasPaymentMicrocredits: 1n,
      onCheckpoint(checkpoint) { checkpoints.push(checkpoint) },
    })

    expect(result.receipt.protocolState).toMatchObject({
      destinationBalanceBeforeAtomic: '100',
      expectedDestinationIncreaseAtomic: '1',
    })
    expect(checkpoints[0]?.deliveryVerification).toEqual({
      balanceBeforeAtomic: '100',
      expectedIncreaseAtomic: '1',
    })
  })
})
