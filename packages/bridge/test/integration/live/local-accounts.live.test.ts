import { join } from 'node:path'
import bs58 from 'bs58'
import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeCheckpoint,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  createSolanaClient,
  solanaHttp,
  solanaKeyPair,
  type BridgeCheckpoint,
  type BridgeProgress,
  type BridgeReceipt,
} from '../../../src/index.js'
import { loadLiveState, saveLiveState, waitForAleoTransaction, waitForHyperlaneDelivery } from './helpers.js'

const liveFunds = process.env.BRIDGE_LIVE_FUNDS === '1'
const mainnetFunds = process.env.BRIDGE_LIVE_MAINNET_ACK === 'I_ACKNOWLEDGE_BRIDGE_MAINNET_FUNDS'
const stateDirectory = process.env.BRIDGE_LIVE_STATE_DIR

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}; live bridge test was explicitly enabled but is not configured`)
  return value
}

async function localAleo(network: 'mainnet' | 'testnet', privateKey: string) {
  const { loadNetwork } = await import('../../../../provable-sdk/src/index.js')
  const aleo = await loadNetwork(network)
  return aleo.createAleoClient({
    privateKey,
    networkUrl: 'https://api.provable.com/v2',
    provingMode: 'local',
    confirmationTimeout: 10 * 60_000,
  })
}

describe.skipIf(!liveFunds || !stateDirectory)('deployed bridges with local accounts', () => {
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
      amount: process.env.BRIDGE_LIVE_XRESERVE_AMOUNT ?? '1',
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

  it.skipIf(!mainnetFunds)('moves native SOL to Aleo with a local Solana keypair', async () => {
    const routeId = 'hyperlane:solana/sol->aleo/sol'
    const path = join(stateDirectory!, 'solana-hyperlane.json')
    const state = loadLiveState(path, routeId)
    const secret = required('BRIDGE_LIVE_SOLANA_SECRET_KEY')
    const secretKeyBytes = secret.startsWith('[') ? Uint8Array.from(JSON.parse(secret) as number[]) : bs58.decode(secret)
    const bridge = createBridgeClient({
      clients: {
        solana: createSolanaClient({
          transport: solanaHttp(required('BRIDGE_LIVE_SOLANA_RPC_URL')),
          account: solanaKeyPair(secretKeyBytes),
        }),
      },
    })
    const plan = bridge.prepare({
      source: { chain: 'solana', asset: 'sol' },
      destination: { chain: 'aleo', asset: 'sol' },
      bridgeProtocol: 'hyperlane',
      amount: process.env.BRIDGE_LIVE_SOL_AMOUNT ?? '0.002',
      recipient: required('BRIDGE_LIVE_ALEO_MAINNET_RECIPIENT'),
      sender: required('BRIDGE_LIVE_SOLANA_ADDRESS'),
    })
    if (!state.sourceTxId) {
      const execution = await bridge.execute({
        plan,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId
          saveLiveState(path, state)
        },
      })
      if (execution.kind !== 'solana-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)
      state.sourceTxId = execution.receipt.sourceTxId
      state.messageId = execution.receipt.messageId
      saveLiveState(path, state)
      if (execution.receipt.protocolState.blockhashExpired === true) {
        throw new Error(`Solana source transaction ${state.sourceTxId} expired; inspect it before explicitly clearing the checkpoint`)
      }
    }
    const delivery = await waitForHyperlaneDelivery(state.sourceTxId!)
    state.messageId = delivery.messageId
    state.destinationTxId = delivery.destinationTxId
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({ completed: true, messageId: expect.any(String), destinationTxId: expect.any(String) })
  }, 30 * 60_000)

  it.skipIf(!mainnetFunds)('moves an Aleo Hyperlane asset with a locally held Aleo account', async () => {
    const routeId = required('BRIDGE_LIVE_ALEO_HYPERLANE_ROUTE_ID')
    const path = join(stateDirectory!, 'aleo-hyperlane.json')
    const state = loadLiveState(path, routeId)
    const aleo = await localAleo('mainnet', required('BRIDGE_LIVE_ALEO_MAINNET_PRIVATE_KEY'))
    const bridge = createBridgeClient({ clients: { aleo: createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient }) } })
    const route = bridge.registry.routes.find((candidate) => candidate.id === routeId)
    if (!route) throw new Error(`Unknown configured bridge route: ${routeId}`)
    const source = bridge.registry.assets.find((asset) => asset.id === route.sourceAssetId)
    const destination = bridge.registry.assets.find((asset) => asset.id === route.destinationAssetId)
    if (!source || !destination) throw new Error(`Configured route has unknown assets: ${routeId}`)
    if (!state.sourceTxId) {
      const plan = bridge.prepare({
        source: { chain: source.chainId, asset: source.key },
        destination: { chain: destination.chainId, asset: destination.key },
        bridgeProtocol: route.protocol,
        amount: required('BRIDGE_LIVE_ALEO_HYPERLANE_AMOUNT'),
        recipient: required('BRIDGE_LIVE_HYPERLANE_DESTINATION_RECIPIENT'),
        sender: String(aleo.account.address),
      })
      const quote = await bridge.quote({ plan })
      if (quote.kind !== 'aleo-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
      const execution = await bridge.execute({
        plan,
        mode: 'signer',
        gasPaymentMicrocredits: quote.paymentMicrocredits,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId
          saveLiveState(path, state)
        },
      })
      if (execution.kind !== 'aleo-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)
      state.sourceTxId = execution.transactionId
      saveLiveState(path, state)
    }
    await waitForAleoTransaction(aleo.publicClient, state.sourceTxId!)
    const delivery = await waitForHyperlaneDelivery(state.sourceTxId!)
    state.messageId = delivery.messageId
    state.destinationTxId = delivery.destinationTxId
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({ completed: true, messageId: expect.any(String), destinationTxId: expect.any(String) })
  }, 30 * 60_000)
})
