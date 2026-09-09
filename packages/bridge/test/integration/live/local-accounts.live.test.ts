import { join } from 'node:path'
import bs58 from 'bs58'
import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  createSolanaClient,
  solanaHttp,
  solanaKeyPair,
  type BridgeTransferReceipt,
} from '../../../src/index.js'
import { loadLiveState, saveLiveState, waitFor, waitForAleoTransaction, waitForHyperlaneDelivery } from './helpers.js'

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
    const plan = bridge.prepareTransfer({
      routeId,
      amount: process.env.BRIDGE_LIVE_XRESERVE_AMOUNT ?? '1',
      recipient,
      sender: required('BRIDGE_LIVE_EVM_TESTNET_ADDRESS'),
      mintMode: 'private',
    })
    const resumed = state.sourceReceipt as BridgeTransferReceipt | undefined
    const deposit = (await bridge.executeEvmXReserveTransfer({
      plan,
      ...(resumed ? { resume: resumed } : {}),
      onSubmitted(receipt) {
        state.sourceTxId = receipt.sourceTxId ?? receipt.id
        state.sourceReceipt = receipt
        saveLiveState(path, state)
      },
    })).receipt
    state.sourceTxId = deposit.sourceTxId ?? state.sourceTxId
    state.sourceReceipt = deposit
    if (deposit.status === 'ATTESTATION_PENDING') state.messageId = deposit.id
    saveLiveState(path, state)
    if (!state.messageId) throw new Error(`xReserve source transaction ${state.sourceTxId} is still confirming; rerun to resume without resubmitting`)
    const attestation = await waitFor(async () => {
      const result = await bridge.getXReserveAttestation({ routeId, messageHash: state.messageId as `0x${string}` })
      return result.status === 'complete' ? result : undefined
    })
    if (!state.destinationTxId) {
      const mint = await bridge.executeXReservePrivateMint({ plan, deposit, attestation })
      state.destinationTxId = mint.transactionId
      saveLiveState(path, state)
    }
    await waitForAleoTransaction(aleo.publicClient, state.destinationTxId)
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
    const plan = bridge.prepareTransfer({
      routeId,
      amount: process.env.BRIDGE_LIVE_SOL_AMOUNT ?? '0.002',
      recipient: required('BRIDGE_LIVE_ALEO_MAINNET_RECIPIENT'),
      sender: required('BRIDGE_LIVE_SOLANA_ADDRESS'),
    })
    if (!state.sourceTxId || state.sourceReceipt) {
      const execution = await bridge.executeSolanaHyperlaneTransfer({
        plan,
        ...(state.sourceReceipt ? { resume: state.sourceReceipt as BridgeTransferReceipt } : {}),
        onSubmitted(receipt) {
          state.sourceTxId = receipt.sourceTxId
          state.sourceReceipt = receipt
          saveLiveState(path, state)
        },
      })
      state.sourceTxId = execution.receipt.sourceTxId
      state.messageId = execution.receipt.messageId
      state.sourceReceipt = execution.receipt
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
    if (!state.sourceTxId) {
      const plan = bridge.prepareTransfer({
        routeId,
        amount: required('BRIDGE_LIVE_ALEO_HYPERLANE_AMOUNT'),
        recipient: required('BRIDGE_LIVE_HYPERLANE_DESTINATION_RECIPIENT'),
        sender: String(aleo.account.address),
      })
      const quote = await bridge.quoteAleoHyperlaneGasPayment({ routeId })
      const execution = await bridge.executeAleoHyperlaneTransferRemote({
        plan,
        mode: 'signer',
        gasPaymentMicrocredits: quote.paymentMicrocredits,
        onSubmitted(receipt) {
          state.sourceTxId = receipt.sourceTxId
          state.sourceReceipt = receipt
          saveLiveState(path, state)
        },
      })
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
