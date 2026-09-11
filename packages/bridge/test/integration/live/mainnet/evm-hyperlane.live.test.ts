import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  type BridgeCheckpoint,
  type BridgeProgress,
} from '../../../../src/index.js'
import { createLiveBenchmark, loadLiveState, saveLiveState, waitForHyperlaneDelivery } from '../helpers.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, oneAtomicUnit, required } from '../config.js'

const enabled = mainnetCaseEnabled('evm-hyperlane')
const ERC20_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])

describe.skipIf(!enabled)('mainnet EVM Hyperlane bridge', () => {
  it('recovers and delivers one atomic unit from Ethereum to Aleo', async () => {
    const benchmark = createLiveBenchmark('evm-hyperlane')
    const routeId = process.env.BRIDGE_LIVE_EVM_HYPERLANE_ROUTE_ID?.trim()
      || 'hyperlane:ethereum/eth->aleo/eth'
    const path = liveStatePath('mainnet', 'evm-hyperlane')
    const state = loadLiveState(path, routeId)
    const evm = createEvmClient({
      transport: evmHttp(required('BRIDGE_LIVE_ETHEREUM_RPC_URL')),
      account: evmPrivateKey(required('BRIDGE_EVM_PRIVATE_KEY') as `0x${string}`),
    })
    const sender = await evm.walletClient!.getAddress()
    const bridge = createBridgeClient({ environment: 'mainnet', clients: { ethereum: evm } })
    benchmark.mark('clients-created')
    const route = bridge.registry.routes.find((candidate) => candidate.id === routeId)
    if (!route) throw new Error(`Unknown configured bridge route: ${routeId}`)
    const source = bridge.registry.assets.find((asset) => asset.id === route.sourceAssetId)
    const destination = bridge.registry.assets.find((asset) => asset.id === route.destinationAssetId)
    if (!source || !destination) throw new Error(`Configured route has unknown assets: ${routeId}`)
    const plan = bridge.prepare({
      source: { chain: source.chainId, asset: source.key },
      destination: { chain: destination.chainId, asset: destination.key },
      bridgeProtocol: 'hyperlane',
      amount: oneAtomicUnit(source.decimals),
      recipient: required('BRIDGE_LIVE_ALEO_MAINNET_RECIPIENT'),
      sender,
    })
    benchmark.mark('plan-prepared')

    let progress: BridgeProgress | undefined
    if (state.checkpoint) {
      progress = await bridge.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
    } else {
      const quote = await bridge.quote({ plan })
      benchmark.mark('quote-returned')
      if (quote.kind !== 'evm-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
      if (quote.tokenAddress && quote.tokenAmountAtomic != null) {
        const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [sender] })
        const result = await evm.publicClient.call({ to: getAddress(quote.tokenAddress), data })
        const balance = decodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', data: result })
        if (balance < quote.tokenAmountAtomic) {
          throw new Error(`Insufficient ${source.symbol} balance: need ${quote.tokenAmountAtomic}, have ${balance}`)
        }
      }
      console.table({ route: routeId, amount: plan.amountIn, sender, recipient: plan.recipient, nativeValueAtomic: quote.nativeValueAtomic.toString() })
      if (!mainnetExecutionEnabled()) return
      await bridge.execute({
        plan,
        confirmationTimeoutMs: 0,
        onCheckpoint(checkpoint) {
          benchmark.mark('checkpoint-saved')
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId ?? state.sourceTxId
          saveLiveState(path, state)
        },
      })
      benchmark.mark('execute-returned')
      progress = await bridge.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
      benchmark.mark('source-recovered')
    }

    if (progress.next === 'wait') progress = await bridge.wait({ progress })
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
      progress = await bridge.wait({
        progress: { next: 'wait', plan: progress.plan, receipt: resumed.receipt },
      })
    }
    if (progress.next === 'failed') throw new Error(progress.error)
    state.sourceTxId = progress.receipt.sourceTxId ?? state.sourceTxId
    saveLiveState(path, state)

    const delivery = await waitForHyperlaneDelivery(state.sourceTxId!)
    benchmark.mark('destination-delivered')
    state.messageId = delivery.messageId
    state.destinationTxId = delivery.destinationTxId
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({ completed: true, messageId: expect.any(String), destinationTxId: expect.any(String) })
  }, 30 * 60_000)
})
