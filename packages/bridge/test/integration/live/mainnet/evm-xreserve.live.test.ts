import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  type BridgeCheckpoint,
  type BridgeProgress,
} from '../../../../src/index.js'
import { createLiveBenchmark, loadLiveState, saveLiveState } from '../helpers.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, required, requiredEvmPrivateKey } from '../config.js'

const enabled = mainnetCaseEnabled('evm-xreserve')

async function delegatedAleo(privateKey: string, apiKey: string) {
  const { loadNetwork } = await import('../../../../../provable-sdk/src/index.js')
  const aleo = await loadNetwork('mainnet')
  return aleo.createAleoClient({
    privateKey,
    networkUrl: 'https://edge.provable.com/api/v2',
    proverUrl: 'https://edge.provable.com/api/prove',
    provingMode: 'delegated',
    auth: { mode: 'api-key', value: apiKey },
    confirmationTimeout: 10 * 60_000,
  })
}

describe.skipIf(!enabled)('mainnet EVM xReserve bridge', () => {
  it('recovers the minimum USDC deposit and privately mints on Aleo', async () => {
    const routeId = 'xreserve:ethereum/usdc->aleo/usdcx'
    const path = liveStatePath('mainnet', 'evm-xreserve-recovery')
    const state = loadLiveState(path, routeId)
    const benchmark = createLiveBenchmark('evm-xreserve')
    const evm = createEvmClient({
      transport: evmHttp(required('BRIDGE_LIVE_ETHEREUM_RPC_URL')),
      account: evmPrivateKey(requiredEvmPrivateKey('BRIDGE_EVM_PRIVATE_KEY')),
    })
    const aleo = await delegatedAleo(
      required('BRIDGE_PRIVATE_KEY'),
      required('EDGE_PROVABLE_API_KEY'),
    )
    benchmark.mark('clients-ready')
    const sender = await evm.walletClient!.getAddress()
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        ethereum: evm,
        aleo: createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient }),
      },
    })
    const plan = bridge.prepare({
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      bridgeProtocol: 'xreserve',
      amount: '2',
      recipient: String(aleo.account.address),
      sender,
      mintMode: 'private',
    })

    let progress: BridgeProgress
    if (!state.checkpoint) {
      const quote = await bridge.quote({ plan })
      benchmark.mark('quote-ready')
      if (quote.kind !== 'evm-xreserve') throw new Error(`Unexpected quote kind: ${quote.kind}`)
      expect(quote.amountAtomic).toBe(2_000_000n)
      console.table({ route: routeId, amount: plan.amountIn, sender, recipient: plan.recipient, maximumProtocolFeeAtomic: quote.maxFeeAtomic.toString() })
      if (!mainnetExecutionEnabled()) return
      await bridge.execute({
        plan,
        confirmationTimeoutMs: 0,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId ?? state.sourceTxId
          saveLiveState(path, state)
        },
      })
      benchmark.mark('source-execute-returned')
    }

    // Recovery is intentionally performed by a newly constructed public-only
    // client, proving that it cannot repeat an approval or deposit.
    const recoveryBridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        ethereum: { family: 'evm', publicClient: evm.publicClient },
        aleo: createAleoClient({ publicClient: aleo.publicClient }),
      },
    })
    progress = await recoveryBridge.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
    benchmark.mark('recovered')
    if (progress.next === 'wait') progress = await recoveryBridge.wait({ progress })
    benchmark.mark('source-wait-returned')
    if (progress.next === 'resume') {
      if (!mainnetExecutionEnabled()) return
      const resumed = await bridge.resume({
        progress,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId ?? state.sourceTxId
          saveLiveState(path, state)
        },
      })
      progress = await recoveryBridge.wait({
        progress: { next: 'wait', plan: progress.plan, receipt: resumed.receipt },
      })
    }
    if (progress.next === 'failed') throw new Error(progress.error)
    if (progress.next === 'complete') {
      if (!mainnetExecutionEnabled()) return
      const completed = await bridge.complete({
        progress,
        onProgress(event) {
          benchmark.mark(event.type)
        },
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.destinationTxId = checkpoint.destination?.transactionId
          saveLiveState(path, state)
          benchmark.mark('destination-checkpoint-saved')
        },
      })
      benchmark.mark('complete-returned')
      progress = await recoveryBridge.wait({
        progress: { next: 'wait', plan: progress.plan, receipt: completed.receipt },
      })
      benchmark.mark('destination-wait-returned')
    }
    if (progress.next === 'failed') throw new Error(progress.error)
    if (progress.next !== 'done') {
      throw new Error(`Expected completed private mint, received ${progress.next}`)
    }

    state.sourceTxId = progress.receipt.sourceTxId ?? state.sourceTxId
    state.messageId = progress.receipt.id
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({
      completed: true,
      sourceTxId: expect.any(String),
      messageId: expect.any(String),
      destinationTxId: expect.any(String),
    })
  }, 30 * 60_000)
})
