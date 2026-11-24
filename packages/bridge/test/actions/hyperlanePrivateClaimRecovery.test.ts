import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWalletClient, DuplicateTransactionError, type Client, type Transaction } from '@provablehq/veil-core'
import { prepare } from '../../src/actions/prepare.js'
import { complete } from '../../src/actions/complete.js'
import { recover } from '../../src/actions/recover.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { PrivateHyperlaneSubmissionError } from '../../src/errors/bridgeErrors.js'
import { deriveXReservePrivateMintAddressCommitment } from '../../src/utils/xreserve.js'
import { hyperlaneCommitmentToLimbs } from '../../src/utils/hyperlane.js'
import type { BridgeCheckpoint, BridgePlan, BridgeReceipt } from '../../src/types/protocol.js'
import { withPrivateMint } from '../fixtures/privateHyperlane.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const ROUTE = 'hyperlane:ethereum/eth->aleo/eth'
const TX = 'at1claim'
const registry = withPrivateMint(DEFAULT_BRIDGE_REGISTRY, ROUTE)
let plan: BridgePlan
beforeAll(async () => {
  const commitmentHex = await deriveXReservePrivateMintAddressCommitment(RECIPIENT, '123scalar', 'mainnet')
  plan = prepare(registry, { source: { chain: 'ethereum', asset: 'eth' }, destination: { chain: 'aleo', asset: 'eth' },
    amount: '0.0000000000000001', recipient: RECIPIENT, hyperlane: { addressEncoding: { commitmentHex } } })
})

function fixture() {
  const ready: BridgeReceipt = { id: 'source-id', sourceTxId: 'source-id', protocol: 'hyperlane',
    status: 'DESTINATION_ACTION_REQUIRED', protocolState: { routeId: ROUTE } }
  const limbs = hyperlaneCommitmentToLimbs(plan.hyperlane!.addressEncoding)
  const transaction = { type: 'execute', id: TX, execution: { global_state_root: '1field', proof: 'proof', transitions: [{
    id: 'au1claim', program: 'test_hyp_warp_token_eth_v2.aleo', function: 'claim_private', tpk: '1group', tcm: '1field',
    inputs: [{ type: 'public', id: 'commitment', value: `[${limbs[0]}u128, ${limbs[1]}u128]` },
      ...[1, 2, 3, 4].map(i => ({ type: 'private', id: `input${i}`, value: `ciphertext1value${i}` }))], outputs: [],
  }] } } as unknown as Transaction
  const state = { status: 'not_found', balance: '100u128', loseResponse: false, duplicate: false, returnedId: TX }
  const sent: string[] = []
  const request = vi.fn(async ({ method, params }: { method: string; params: Record<string, unknown> }) => {
    if (method === 'getMappingValue' && params.mapping === 'claimable') return state.balance
    if (method === 'getConfirmedTransaction' && ['accepted', 'rejected'].includes(state.status)) return { status: state.status }
    if (method === 'getUnconfirmedTransaction' && state.status === 'pending') return transaction
    if (method === 'sendTransaction') {
      sent.push(params.transaction as string)
      if (state.loseResponse) throw new Error('Submission response lost')
      if (state.duplicate) throw new DuplicateTransactionError(TX)
      return state.returnedId
    }
    throw new Error('Transaction not found')
  })
  const buildTransaction = vi.fn(async () => transaction)
  const walletClient = createWalletClient({
    account: { type: 'local', address: RECIPIENT, sign: vi.fn() } as never,
    transport: { config: { network: 'mainnet' }, request } as never,
    proving: { buildTransaction } as never,
  })
  const publicClient = { request } as unknown as Client
  const clients = { aleo: { family: 'aleo' as const, publicClient, walletClient } }
  const checkpoints: BridgeCheckpoint[] = []
  const params = { plan, receipt: ready, skipRouteStatus: true,
    hyperlane: { secretNonce: '123scalar', merkleProof: '[recipient-proof]' },
    onCheckpoint: (checkpoint: BridgeCheckpoint) => { checkpoints.push(checkpoint) } }
  const saved = () => checkpoints.at(-1) ?? createBridgeCheckpoint(plan, ready)
  return { clients, params, checkpoints, saved, state, sent, buildTransaction, transaction }
}

describe('private Hyperlane claim checkpoints', () => {
  it.each(['accepted', 'pending'])('recovers a claim with status %s after its broadcast response is lost', async status => {
    const f = fixture()
    f.state.loseResponse = true
    await expect(complete(registry, f.clients, f.params)).rejects.toThrow('Submission response lost')
    f.state.status = status
    if (status === 'accepted') f.state.balance = '0u128'
    const progress = await recover(registry, f.clients, fetch, { checkpoint: f.saved() })
    expect(progress.next).toBe(status === 'accepted' ? 'done' : 'wait')
    expect(progress.receipt.destinationTxId).toBe(TX)
    expect(f.sent).toHaveLength(1)
  })

  it.each([false, true])('reuses the proved bytes without a wallet when broadcast is unknown (duplicate: %s)', async duplicate => {
    const f = fixture()
    f.state.loseResponse = true
    await expect(complete(registry, f.clients, f.params)).rejects.toThrow('Submission response lost')
    const saved = f.saved()
    expect(JSON.stringify(saved)).not.toMatch(/123scalar|recipient-proof/)
    const clients = { aleo: { family: 'aleo' as const, publicClient: f.clients.aleo.publicClient } }
    const progress = await recover(registry, clients, fetch, { checkpoint: saved })
    expect(progress.next).toBe('complete')
    if (progress.next !== 'complete') throw new Error('Expected byte-for-byte retry')
    f.state.loseResponse = false
    f.state.duplicate = duplicate
    const result = await complete(registry, clients, { progress, skipRouteStatus: true })
    expect(result.receipt).toMatchObject({ status: 'DESTINATION_CONFIRMING', destinationTxId: TX })
    expect(f.sent).toEqual([JSON.stringify(f.transaction), JSON.stringify(f.transaction)])
    expect(f.buildTransaction).toHaveBeenCalledOnce()
  })

  it('stops before broadcasting when the prepared checkpoint cannot be saved', async () => {
    const f = fixture()
    await expect(complete(registry, f.clients, { ...f.params, onCheckpoint: () => { throw new Error('Storage unavailable') } })).rejects.toThrow('Storage unavailable')
    expect(f.sent).toEqual([])
  })

  it.each(['pending', 'accepted'])('observes a prepared claim that became %s after recovery without resubmitting', async status => {
    const f = fixture()
    f.state.loseResponse = true
    await expect(complete(registry, f.clients, f.params)).rejects.toThrow('Submission response lost')
    const progress = await recover(registry, f.clients, fetch, { checkpoint: f.saved() })
    if (progress.next !== 'complete') throw new Error('Expected byte-for-byte retry')
    f.state.status = status
    const result = await complete(registry, f.clients, { progress, skipRouteStatus: true })
    expect(result.receipt.status).toBe(status === 'accepted' ? 'COMPLETED' : 'DESTINATION_CONFIRMING')
    expect(f.sent).toHaveLength(1)
  })

  it('preserves submitted state before a progress callback can fail', async () => {
    const f = fixture()
    const error = await complete(registry, f.clients, { ...f.params,
      onProgress: event => { if (event.type === 'transaction-submitted') throw new Error('Reporting failed') },
    }).catch(error => error)
    expect(error).toBeInstanceOf(PrivateHyperlaneSubmissionError)
    expect(error.checkpoint.destination).toMatchObject({ transactionId: TX, preparedTransaction: { serializedTransaction: JSON.stringify(f.transaction) } })
    expect(f.saved().destination).toEqual(error.checkpoint.destination)
    f.state.status = 'accepted'
    f.state.balance = '0u128'
    expect((await recover(registry, f.clients, fetch, { checkpoint: f.saved() })).next).toBe('done')
  })

  it('rebroadcasts the same bytes after a successful broadcast is dropped, retaining them until acceptance', async () => {
    const f = fixture()
    await complete(registry, f.clients, f.params)
    expect(f.saved().destination).toEqual({
      transactionId: TX,
      preparedTransaction: { transactionId: TX, serializedTransaction: JSON.stringify(f.transaction) },
    })
    const clients = { aleo: { family: 'aleo' as const, publicClient: f.clients.aleo.publicClient } }
    const progress = await recover(registry, clients, fetch, { checkpoint: f.saved() })
    expect(progress.next).toBe('complete')
    const resubmitted = await complete(registry, clients, { progress, skipRouteStatus: true })
    const checkpoint = createBridgeCheckpoint(plan, resubmitted.receipt)
    expect(checkpoint.destination?.preparedTransaction).toEqual(f.saved().destination?.preparedTransaction)
    expect(f.sent).toEqual([JSON.stringify(f.transaction), JSON.stringify(f.transaction)])
    expect(f.buildTransaction).toHaveBeenCalledOnce()
    f.state.status = 'accepted'
    const accepted = await recover(registry, clients, fetch, { checkpoint })
    expect(accepted.next).toBe('done')
    expect(createBridgeCheckpoint(plan, accepted.receipt).destination).toEqual({ transactionId: TX })
  })

  it.each(['fresh', 'rebroadcast'])('preserves canonical claim recovery after a conflicting %s broadcast id', async path => {
    const f = fixture()
    let progress
    if (path === 'rebroadcast') {
      f.state.loseResponse = true
      await expect(complete(registry, f.clients, f.params)).rejects.toThrow('Submission response lost')
      progress = await recover(registry, f.clients, fetch, { checkpoint: f.saved() })
      f.state.loseResponse = false
    }
    f.state.returnedId = 'at1conflicting'
    const error = await complete(registry, f.clients, progress
      ? { progress, skipRouteStatus: true }
      : { ...f.params, onCheckpoint: undefined }).catch(error => error)
    expect(error).toBeInstanceOf(PrivateHyperlaneSubmissionError)
    expect(error.receipt).toMatchObject({ destinationTxId: TX, protocolState: { reportedDestinationTxId: 'at1conflicting' } })
    expect(error.checkpoint.destination).toEqual({ transactionId: TX,
      preparedTransaction: { transactionId: TX, serializedTransaction: JSON.stringify(f.transaction) },
    })
    f.state.status = 'accepted'
    expect((await recover(registry, f.clients, fetch, { checkpoint: error.checkpoint })).next).toBe('done')
  })

  it('discards rejected prepared bytes before authorizing a new claim', async () => {
    const f = fixture()
    f.state.loseResponse = true
    await expect(complete(registry, f.clients, f.params)).rejects.toThrow('Submission response lost')
    f.state.status = 'rejected'
    const progress = await recover(registry, f.clients, fetch, { checkpoint: f.saved() })
    expect(progress.next).toBe('complete')
    expect(progress.receipt.protocolState.preparedDestinationTransaction).toBeUndefined()
    expect(createBridgeCheckpoint(plan, progress.receipt).destination).toBeUndefined()
  })

  it.each(['id', 'commitment'])('rejects a prepared claim with an altered %s before broadcasting', async changed => {
    const f = fixture()
    f.state.loseResponse = true
    await expect(complete(registry, f.clients, f.params)).rejects.toThrow('Submission response lost')
    const saved = f.saved()
    const prepared = saved.destination?.preparedTransaction
    expect(prepared).toBeDefined()
    if (!prepared) throw new Error('Missing prepared claim')
    const transaction = JSON.parse(prepared.serializedTransaction) as Transaction
    if (changed === 'id') transaction.id = 'at1other'
    else transaction.execution!.transitions[0]!.inputs![0]!.value = '[0u128, 0u128]'
    prepared.serializedTransaction = JSON.stringify(transaction)
    await expect(recover(registry, f.clients, fetch, { checkpoint: saved })).rejects.toThrow(/prepared|Prepared/)
    expect(f.sent).toHaveLength(1)
  })
})
