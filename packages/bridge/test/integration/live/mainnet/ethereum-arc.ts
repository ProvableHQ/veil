import { expect } from 'vitest'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import {
  createBridgeClient,
  createBridgeCheckpoint,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  type BridgeCheckpoint,
} from '../../../../src/index.js'
import { liveStatePath, mainnetExecutionEnabled, requiredEvmPrivateKey } from '../config.js'
import { createLiveBenchmark, loadLiveState, saveLiveState } from '../helpers.js'

/** Funds both Aleo test legs through a checkpointed native USDC transfer. */
// Five USDC funds both requested two-USDC Aleo tests and leaves room for Arc gas.
export async function fundArcFromEthereum(): Promise<boolean> {
  const benchmark = createLiveBenchmark('ethereum-arc')
  const routeId = 'cctp:ethereum/usdc->arc/usdc'
  const path = liveStatePath('mainnet', 'ethereum-arc-aleo-funding')
  const state = loadLiveState(path, routeId)
  const ethereum = createEvmClient({
    transport: evmHttp(process.env.BRIDGE_LIVE_ETHEREUM_RPC_URL?.trim() || 'https://ethereum-rpc.publicnode.com'),
    // A bounded 1-gwei tip avoids zero-tip public RPC estimates stalling this live test.
    walletClient: createWalletClient({
      account: privateKeyToAccount(requiredEvmPrivateKey('BRIDGE_EVM_PRIVATE_KEY')),
      chain: { ...mainnet, fees: { maxPriorityFeePerGas: 1_000_000_000n } },
      transport: http(process.env.BRIDGE_LIVE_ETHEREUM_RPC_URL?.trim() || 'https://ethereum-rpc.publicnode.com'),
    }),
  })
  const arc = createEvmClient({
    transport: evmHttp(process.env.BRIDGE_LIVE_ARC_RPC_URL?.trim() || 'https://rpc.mainnet.arc.io'),
    account: evmPrivateKey(requiredEvmPrivateKey('BRIDGE_EVM_PRIVATE_KEY')),
  })
  const sender = await ethereum.walletClient!.getAddress()
  const bridge = createBridgeClient({ environment: 'mainnet', clients: { ethereum, arc } })
  const recovery = createBridgeClient({
    environment: 'mainnet',
    clients: { ethereum: { family: 'evm', publicClient: ethereum.publicClient }, arc: { family: 'evm', publicClient: arc.publicClient } },
  })
  const persist = (checkpoint: BridgeCheckpoint) => {
    state.checkpoint = checkpoint
    state.sourceTxId = checkpoint.source?.transactionId ?? state.sourceTxId
    state.destinationTxId = checkpoint.destination?.transactionId ?? state.destinationTxId
    saveLiveState(path, state)
    benchmark.mark(checkpoint.destination?.transactionId ? 'destination-checkpoint' : checkpoint.source?.transactionId ? 'burn-checkpoint' : 'approval-checkpoint')
  }
  if (!state.checkpoint) {
    const quote = await bridge.quote({
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'arc', asset: 'usdc' },
      bridgeProtocol: 'cctp', amount: '5', sender, recipient: sender,
      cctp: { speed: 'fast', forwarding: true, maxFee: '0.25' },
    })
    if (quote.kind !== 'evm-cctp') throw new Error(`Unexpected quote kind: ${quote.kind}`)
    expect(quote.amountAtomic).toBe(5_000_000n)
    expect(quote.amountOutAtomic).toBeGreaterThan(4_000_000n)
    console.table({ route: routeId, amount: '5', sender, recipient: sender, quotedFeeAtomic: (quote.protocolFeeAtomic + quote.forwardingFeeAtomic).toString(), expectedArcUsdcAtomic: quote.amountOutAtomic.toString(), maximumFeeAtomic: quote.maxFeeAtomic.toString() })
    if (!mainnetExecutionEnabled()) return false
    await bridge.execute({ plan: quote.plan, confirmationTimeoutMs: 0, onCheckpoint: persist })
  }
  benchmark.mark('source-submission-returned')
  let progress = await recovery.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
  if (progress.next === 'wait' && progress.receipt.status === 'DELIVERY_PENDING'
    && process.env.BRIDGE_LIVE_CCTP_MANUAL_MINT === '1') {
    if (!mainnetExecutionEnabled()) return false
    const minted = await bridge.complete({ progress, cctp: { manualMint: true }, onCheckpoint: persist })
    progress = { next: 'wait', plan: progress.plan, receipt: minted.receipt }
  }
  if (progress.next === 'wait') progress = await recovery.wait({ progress })
  if (progress.next === 'resume') {
    if (!mainnetExecutionEnabled()) return false
    const resumed = await bridge.resume({ progress, onCheckpoint: persist })
    progress = await recovery.wait({ progress: { next: 'wait', plan: progress.plan, receipt: resumed.receipt } })
  }
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Expected verified CCTP delivery, received ${progress.next}`)
  persist(createBridgeCheckpoint(progress.plan, progress.receipt))
  benchmark.mark('arc-delivery-verified')
  state.completed = true
  state.messageId = progress.receipt.id
  saveLiveState(path, state)
  expect(state).toMatchObject({ completed: true, sourceTxId: expect.any(String), destinationTxId: expect.any(String) })
  return true
}
