import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeCheckpoint,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  type BridgeCheckpoint,
  type BridgeProgress,
  type BridgeReceipt,
} from '../../../../src/index.js'
import { loadLiveState, saveLiveState } from '../helpers.js'
import { liveFundsEnabled, required } from '../config.js'

const stateDirectory = process.env.BRIDGE_LIVE_STATE_DIR

async function localAleo(network: 'mainnet' | 'testnet', privateKey: string) {
  const { loadNetwork } = await import('../../../../../provable-sdk/src/index.js')
  const aleo = await loadNetwork(network)
  return aleo.createAleoClient({
    privateKey,
    networkUrl: 'https://api.provable.com/v2',
    provingMode: 'local',
    confirmationTimeout: 10 * 60_000,
  })
}

describe.skipIf(!liveFundsEnabled())('deployed testnet bridges with local accounts', () => {
  it('moves Sepolia USDC to Aleo testnet through xReserve and locally mints the private output', async () => {
    const routeId = 'xreserve:sepolia/usdc->aleo-testnet/usdcx'
    const path = join(stateDirectory!, 'evm-xreserve.json')
    const state = loadLiveState(path, routeId)
    const aleo = await localAleo('testnet', required('BRIDGE_LIVE_ALEO_TESTNET_PRIVATE_KEY'))
    const recipient = String(aleo.account.address)
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: {
        sepolia: createEvmClient({
          transport: evmHttp(required('BRIDGE_LIVE_SEPOLIA_RPC_URL')),
          account: evmPrivateKey(required('BRIDGE_LIVE_EVM_TESTNET_PRIVATE_KEY') as `0x${string}`),
        }),
        'aleo-testnet': createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient }),
      },
    })
    const plan = bridge.prepare({
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      bridgeProtocol: 'xreserve',
      amount: process.env.BRIDGE_LIVE_XRESERVE_AMOUNT ?? '2',
      recipient,
      sender: required('BRIDGE_LIVE_EVM_TESTNET_ADDRESS'),
      mintMode: 'private',
    })
    const storedCheckpoint = state.checkpoint as Partial<BridgeCheckpoint> | undefined
    if (storedCheckpoint && !storedCheckpoint.intent && !state.sourceReceipt) {
      throw new Error('Legacy checkpoint cannot be migrated without its saved source receipt')
    }
    const savedCheckpoint = storedCheckpoint?.intent
      ? storedCheckpoint as BridgeCheckpoint
      : (state.sourceReceipt
        ? createBridgeCheckpoint(plan, state.sourceReceipt as BridgeReceipt)
        : undefined)
    if (savedCheckpoint && (!storedCheckpoint || !storedCheckpoint.intent)) {
      state.checkpoint = savedCheckpoint
      saveLiveState(path, state)
    }
    let progress: BridgeProgress | undefined = savedCheckpoint
      ? await bridge.recover({ checkpoint: savedCheckpoint })
      : undefined
    if (!progress) {
      const depositExecution = await bridge.execute({
        plan,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId ?? state.sourceTxId
          saveLiveState(path, state)
        },
      })
      if (depositExecution.kind !== 'evm-xreserve') throw new Error(`Unexpected execution kind: ${depositExecution.kind}`)
      progress = { next: 'wait', plan, receipt: depositExecution.receipt }
      state.sourceTxId = depositExecution.receipt.sourceTxId ?? state.sourceTxId
      saveLiveState(path, state)
    }
    if (progress.next === 'wait') {
      progress = await bridge.wait({
        progress,
        onUpdate(value) {
          state.messageId = value.receipt.id
          saveLiveState(path, state)
        },
      })
    }
    if (progress.next === 'resume') {
      const resumed = await bridge.resume({
        progress,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId ?? state.sourceTxId
          saveLiveState(path, state)
        },
      })
      progress = await bridge.wait({
        progress: { next: 'wait', plan, receipt: resumed.receipt },
      })
    }
    if (progress.next === 'complete') {
      const mint = await bridge.complete({
        progress,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.destinationTxId = checkpoint.destination?.transactionId
          saveLiveState(path, state)
        },
      })
      progress = await bridge.wait({
        progress: { next: 'wait', plan, receipt: mint.receipt },
        onUpdate() { saveLiveState(path, state) },
      })
    }
    if (progress.next === 'failed') throw new Error(progress.error)
    if (progress.next !== 'done') throw new Error(`Unexpected xReserve operation: ${progress.next}`)
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({ completed: true, sourceTxId: expect.any(String), messageId: expect.any(String), destinationTxId: expect.any(String) })
  }, 30 * 60_000)

})
