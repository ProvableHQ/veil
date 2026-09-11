import bs58 from 'bs58'
import { createPublicClient as createAleoPublicClient, http as aleoHttp } from '@provablehq/veil-core'
import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeClient,
  createSolanaClient,
  solanaHttp,
  solanaKeyPair,
  type BridgeCheckpoint,
} from '../../../../src/index.js'
import { createLiveBenchmark, loadLiveState, saveLiveState, waitForHyperlaneDelivery } from '../helpers.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, oneAtomicUnit, required } from '../config.js'

const enabled = mainnetCaseEnabled('solana-hyperlane')

describe.skipIf(!enabled)('mainnet Solana Hyperlane bridge', () => {
  it('moves the minimum SOL amount to Aleo with a local keypair', async () => {
    const benchmark = createLiveBenchmark('solana-hyperlane')
    const routeId = 'hyperlane:solana/sol->aleo/sol'
    const path = liveStatePath('mainnet', 'solana-hyperlane')
    const state = loadLiveState(path, routeId)
    const secret = required('BRIDGE_SOLANA_PRIVATE_KEY')
    const secretKeyBytes = secret.startsWith('[')
      ? Uint8Array.from(JSON.parse(secret) as number[])
      : bs58.decode(secret)
    const client = createSolanaClient({
      transport: solanaHttp(required('BRIDGE_LIVE_SOLANA_RPC_URL')),
      account: solanaKeyPair(secretKeyBytes),
    })
    const aleo = createAleoClient({
      publicClient: createAleoPublicClient({
        transport: aleoHttp('https://edge.provable.com/api/v2', { network: 'mainnet' }),
      }),
    })
    const sender = await client.walletClient!.getAddress()
    const bridge = createBridgeClient({ clients: { solana: client, aleo } })
    benchmark.mark('clients-created')
    const source = bridge.getAssets({ chainId: 'solana', symbol: 'SOL' })[0]!
    const plan = bridge.prepare({
      source: { chain: 'solana', asset: 'sol' },
      destination: { chain: 'aleo', asset: 'sol' },
      bridgeProtocol: 'hyperlane',
      amount: oneAtomicUnit(source.decimals),
      recipient: required('BRIDGE_LIVE_ALEO_MAINNET_RECIPIENT'),
      sender,
    })
    benchmark.mark('plan-prepared')

    if (!state.sourceTxId) {
      const quote = await bridge.quote({ plan })
      benchmark.mark('quote-returned')
      if (quote.kind !== 'solana-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
      console.table({ route: routeId, amount: plan.amountIn, sender, recipient: plan.recipient, totalLamports: quote.totalLamports.toString() })
      if (!mainnetExecutionEnabled()) return
      const execution = await bridge.execute({
        plan,
        onCheckpoint(checkpoint) {
          benchmark.mark('checkpoint-saved')
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId
          saveLiveState(path, state)
        },
      })
      benchmark.mark('execute-returned')
      if (execution.kind !== 'solana-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)
      state.sourceTxId = execution.receipt.sourceTxId
      state.messageId = execution.receipt.messageId
      saveLiveState(path, state)
      if (execution.receipt.protocolState.blockhashExpired === true) {
        throw new Error(`Solana source transaction ${state.sourceTxId} expired; inspect it before clearing the checkpoint`)
      }
    }

    if (!state.checkpoint) throw new Error('Solana Hyperlane source has no recovery checkpoint')
    let progress = await bridge.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
    if (progress.next === 'wait') progress = await bridge.wait({ progress })
    if (progress.next === 'failed') throw new Error(progress.error)
    if (progress.next !== 'done') throw new Error(`Expected completed Hyperlane delivery, received ${progress.next}`)
    benchmark.mark('destination-delivered')
    state.messageId = progress.receipt.messageId
    if (!state.destinationTxId) {
      const delivery = await waitForHyperlaneDelivery(state.sourceTxId!)
      state.destinationTxId = delivery.destinationTxId
    }
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({ completed: true, messageId: expect.any(String), destinationTxId: expect.any(String) })
  }, 30 * 60_000)
})
