import { describe, expect, it, vi } from 'vitest'
import type { Client, Transaction, OwnedRecord } from '@provablehq/veil-core'
import { getRecordInventory } from '@provablehq/veil-core'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { prepare } from '../../src/actions/prepare.js'
import { execute } from '../../src/actions/execute.js'
import { recover } from '../../src/actions/recover.js'
import { resume } from '../../src/actions/resume.js'
import { getStatus } from '../../src/actions/getStatus.js'
import { buildAleoHyperlaneTransferRemoteCall, buildAleoHyperlanePrivateTransferCall, hyperlanePrivateTransferGrants, PrivateHyperlaneSubmissionError, hyperlane } from '../../src/index.js'
import type { AleoWalletClient } from '../../src/types/aleo.js'
import type { BridgeCheckpoint, BridgeRegistry } from '../../src/types/protocol.js'
import type { AleoHyperlanePrivateTransferCall } from '../../src/types/hyperlanePrivateTransfer.js'

vi.mock('@provablehq/veil-core', async importOriginal => ({ ...await importOriginal<typeof import('@provablehq/veil-core')>(), getRecordInventory: vi.fn() }))

const ROUTE = 'hyperlane:aleo/eth->ethereum/eth'
const OWNER = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const record = (field: string, value: bigint, nonce: number, owner = OWNER) => `{ owner: ${owner}.private, ${field}: ${value}${field === 'amount' ? 'u128' : 'u64'}.private, _nonce: ${nonce}group.public }`
const TOKEN = record('amount', 10n ** 18n, 1)
const DISPATCH = record('microcredits', 20_000_000n, 2)
const FEE = record('microcredits', 5_000_000n, 3)
const PROOF = '[signer_exclusion_proofs]'
const TX = 'at1private'

function prepared(call: AleoHyperlanePrivateTransferCall, privateFee = false): Transaction {
  const input = (type: string, id: string, value?: string) => ({ type, id, ...(value ? { value } : {}) })
  return { type: 'execute', id: TX, execution: { proof: 'proof', global_state_root: '1field', transitions: [{
    id: 'au1private', program: call.program, function: call.function, tpk: '1group', tcm: '1field',
    inputs: call.inputs.map((value, i) => i === 0 || i === 1 ? input('record', `serial${i}`)
      : i === 9 ? input('private', 'proof-input', 'ciphertext') : input('public', `input${i}`, value as string)),
  }] }, fee: { proof: 'proof', global_state_root: '1field', transition: {
    id: 'au1fee', program: 'credits.aleo', function: privateFee ? 'fee_private' : 'fee_public', tpk: '1group', tcm: '1field',
    inputs: [...(privateFee ? [input('record', 'fee-serial')] : []), input('public', 'base', '1000000u64'), input('public', 'priority', '0u64')],
  } } }
}

async function fixture(options: { local?: boolean; privateFee?: boolean } = {}) {
  const sourceAsset = DEFAULT_BRIDGE_REGISTRY.assets.find(asset => asset.id === 'aleo/eth')!
  const registry: BridgeRegistry = { ...DEFAULT_BRIDGE_REGISTRY, routes: DEFAULT_BRIDGE_REGISTRY.routes.map(route => route.id === ROUTE ? {
    ...route, metadata: { ...route.metadata,
      aleoPrivateTransferAbi: 'transfer_remote_private_v1', aleoPrivateTransferCommit: 'c8b413bef975e736d9c9f52d4f4ce6113f8846ae',
      aleoPrivateTransferFeeMapping: 'private_transfer_fee_bps__', aleoPrivateTransferFeeKey: 'false',
      aleoPrivateTransferExecutionVerified: true, aleoPrivateTransferTokenProgram: sourceAsset.privacy!.program,
      aleoPrivateTransferFreezelistProgram: 'shield_arc22_freezelist.aleo', aleoMailboxProgram: 'hyp_mailbox.aleo',
      aleoPrivateTransferPauseMapping: 'bridge_pause', aleoPrivateTransferPauseKey: 'true',
    },
  } : route) }
  const plan = prepare(registry, { source: { chain: 'aleo', asset: 'eth' }, destination: { chain: 'ethereum', asset: 'eth' }, amount: '1', recipient: '0x0000000000000000000000000000000000000001' })
  const base = buildAleoHyperlaneTransferRemoteCall(registry, { plan, gasPaymentMicrocredits: 1n })
  const state = { rate: '25u16', pause: '[false, false]', app: base.inputs[0], router: base.inputs[2], mailbox: base.inputs[1], balance: 100n, confirmed: 'accepted' }
  const request = vi.fn(async ({ method, params }: { method: string; params: Record<string, unknown> }): Promise<unknown> => {
    if (method === 'getMappingValue') {
      if (params.mapping === 'private_transfer_fee_bps__') return state.rate
      if (params.mapping === 'hooks') return params.key === registry.routes.find(r => r.id === ROUTE)!.metadata!.aleoMailboxRequiredHook ? '3u8' : '4u8'
      if (params.mapping === 'destination_gas_configs') return '{ gas_overhead: 159337u128, exchange_rate: 402u128, gas_price: 1000000000u128 }'
      if (params.mapping === 'app_metadata') return state.app
      if (params.mapping === 'remote_routers') return state.router
      if (params.mapping === 'mailbox') return state.mailbox
      if (params.mapping === 'bridge_pause') return state.pause
      throw new Error(`Unexpected mapping ${params.mapping}`)
    }
    if (method === 'getConfirmedTransaction') return { status: state.confirmed }
    if (method === 'sendTransaction') return TX
    throw new Error(`Unexpected method ${method}`)
  })
  const publicClient = { request, transport: { config: { network: 'mainnet' } } } as unknown as Client
  const quote = await hyperlane.aleo.quotePrivateTransfer(publicClient, { registry, plan })
  const call = buildAleoHyperlanePrivateTransferCall(registry, { plan, quote })
  const transaction = prepared(call, options.privateFee)
  const broadcast = vi.fn()
  const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>(async params => {
    await params.onProgress?.({ type: 'request-built' })
    if (options.local) await params.onProgress?.({ type: 'transaction-prepared', transactionId: TX, transaction })
    broadcast()
    await params.onProgress?.({ type: 'transaction-submitted', transactionId: TX })
    return TX
  })
  const wallet: AleoWalletClient = { executeTransaction, account: { type: options.local ? 'local' : 'rpc', address: OWNER } as never }
  const clients = { aleo: { family: 'aleo' as const, publicClient, walletClient: wallet },
    ethereum: { family: 'evm' as const, publicClient: { getBalance: async () => state.balance } as never } }
  return { registry, plan, quote, call, state, request, publicClient, wallet, clients, executeTransaction, broadcast, transaction }
}

const localFunding = { tokenRecord: TOKEN, dispatchCreditsRecord: DISPATCH, merkleProof: PROOF }

describe('private outbound Hyperlane execution', () => {
  it('builds exactly eleven inputs without changing the public builder', async () => {
    const f = await fixture()
    expect(f.call.function).toBe('transfer_remote_private')
    expect(f.call.inputs).toHaveLength(11)
    expect(f.call.inputs[0]).toMatchObject({ type: 'record', program: 'arc20_eth.aleo', recordname: 'Token', filters: { amount: { gte: '1000000000000000000u128' } } })
    expect(f.call.inputs[1]).toMatchObject({ type: 'record', program: 'credits.aleo', filters: { microcredits: { gte: '8174147u64' } } })
    expect(f.call.inputs[7]).toBe('1000000000000000000u128')
    expect(f.call.inputs[9]).toMatchObject({ type: 'derived', algorithm: 'program-freezelist-exclusion-proof', args: { freezelistProgram: { value: 'shield_arc22_freezelist.aleo' } } })
    expect(f.call.inputs[10]).toBe('25u16')
    expect(buildAleoHyperlaneTransferRemoteCall(f.registry, { plan: f.plan }).function).toBe('transfer_remote')
    expect(hyperlanePrivateTransferGrants({ registry: f.registry, plan: f.plan })[0]).toMatchObject({ function: 'transfer_remote_private', inputPosition: 9, argConstraints: { freezelistProgram: ['shield_arc22_freezelist.aleo'] } })
  })

  it('executes through the high-level opt-in path and saves only net public recovery state', async () => {
    const f = await fixture()
    const checkpoints: BridgeCheckpoint[] = []
    const result = await execute(f.registry, f.clients, { plan: f.plan, hyperlanePrivateTransfer: { quote: f.quote }, skipRouteStatus: true, onCheckpoint: checkpoint => { checkpoints.push(checkpoint) } })
    expect(result.kind).toBe('aleo-hyperlane')
    expect(f.executeTransaction.mock.calls[0]![0]).toMatchObject({ program: f.call.program, function: 'transfer_remote_private', privateFee: false })
    expect(result.receipt.protocolState.expectedDestinationIncreaseAtomic).toBe(f.quote.destinationAmountAtomic.toString())
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]!.source).toMatchObject({ transactionId: TX, privateHyperlane: true })
    expect(JSON.stringify(checkpoints)).not.toMatch(/recordname|microcredits.*gte|signer_exclusion_proofs/)
    expect(checkpoints[0]!.deliveryVerification).toEqual({ balanceBeforeAtomic: '100', expectedIncreaseAtomic: f.quote.destinationAmountAtomic.toString() })
  })

  it.each(['recipient', 'amount', 'token-fee', 'fingerprint', 'hooks'])('rejects an altered quote or intent (%s) before wallet authorization', async invalid => {
    const f = await fixture()
    const plan = { ...f.plan }
    const quote = { ...f.quote, hookPayments: f.quote.hookPayments.map(payment => ({ ...payment })) }
    if (invalid === 'recipient') plan.recipient = '0x0000000000000000000000000000000000000002'
    if (invalid === 'amount') plan.amountIn = '2'
    if (invalid === 'token-fee') quote.protocolFeeAtomic++
    if (invalid === 'fingerprint') quote.transferFingerprint = undefined
    if (invalid === 'hooks') quote.hookPayments[0]!.paymentMicrocredits++
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan, quote, skipRouteStatus: true })).rejects.toThrow(/quote|intent/)
    expect(f.executeTransaction).not.toHaveBeenCalled()
  })

  it.each(['fee', 'app', 'router', 'mailbox', 'pause'])('rejects changed live state (%s) before asking the wallet', async changed => {
    const f = await fixture()
    if (changed === 'fee') f.state.rate = '26u16'
    if (changed === 'app') f.state.app = '{}'
    if (changed === 'router') f.state.router = '{}'
    if (changed === 'mailbox') f.state.mailbox = '{}'
    if (changed === 'pause') f.state.pause = '[false, true]'
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, skipRouteStatus: true })).rejects.toThrow(/changed|differs|paused/)
    expect(f.executeTransaction).not.toHaveBeenCalled()
  })

  it('checks a local fee update after proving and refuses broadcast', async () => {
    const f = await fixture({ local: true })
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, skipRouteStatus: true,
      onProgress: event => { if (event.type === 'request-built') f.state.rate = '26u16' },
    })).rejects.toThrow(/fees changed/)
    expect(f.broadcast).not.toHaveBeenCalled()
  })

  it('rejects placeholder/unreviewed private execution metadata even when fee quoting was possible', async () => {
    const f = await fixture()
    const registry = { ...f.registry, routes: f.registry.routes.map(route => route.id === ROUTE ? { ...route, metadata: { ...route.metadata, aleoPrivateTransferExecutionVerified: false } } : route) }
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry, plan: f.plan, quote: f.quote })).rejects.toThrow(/reviewed eleven-input/)
    expect(f.executeTransaction).not.toHaveBeenCalled()
  })

  it('requires a destination reader and never promises gross delivery', async () => {
    const f = await fixture()
    await expect(hyperlane.aleo.executePrivateTransfer({ aleo: f.clients.aleo }, { registry: f.registry, plan: f.plan, quote: f.quote, skipRouteStatus: true })).rejects.toThrow(/destination balance reader/)
    expect(f.executeTransaction).not.toHaveBeenCalled()
  })

  it.each(['token', 'credits', 'owner', 'request', 'proof'])('rejects invalid private funding or proofs (%s)', async invalid => {
    const f = await fixture({ local: true })
    const options = { ...localFunding } as { tokenRecord: unknown; dispatchCreditsRecord: unknown; merkleProof: unknown }
    if (invalid === 'token') options.tokenRecord = record('amount', 1n, 1)
    if (invalid === 'credits') options.dispatchCreditsRecord = record('microcredits', 1n, 2)
    if (invalid === 'owner') options.tokenRecord = record('amount', 10n ** 18n, 1, 'aleo1other')
    if (invalid === 'request') options.tokenRecord = { type: 'record', program: 'arc20_eth.aleo', recordname: 'Token' }
    if (invalid === 'proof') options.merkleProof = { type: 'derived', algorithm: 'program-freezelist-exclusion-proof', args: { freezelistProgram: { type: 'string', value: 'other.aleo' } } }
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...options as typeof localFunding, skipRouteStatus: true })).rejects.toThrow()
    expect(f.executeTransaction).not.toHaveBeenCalled()
  })

  it('selects the smallest unreserved local records through the existing inventory interface', async () => {
    const f = await fixture({ local: true })
    vi.mocked(getRecordInventory).mockImplementation(async (_client, params) => ({
      asset: { ...params.asset, recordName: params.asset.program === 'credits.aleo' ? 'credits' : 'Token', amountField: params.asset.program === 'credits.aleo' ? 'microcredits' : 'amount', amountType: 'u128' },
      balance: 10n ** 20n, reserved: [], available: params.asset.program === 'credits.aleo'
        ? [{ id: '2group', amount: 20_000_000n, record: { recordPlaintext: DISPATCH } as OwnedRecord }]
        : [{ id: '4group', amount: 2n * 10n ** 18n, record: { recordPlaintext: record('amount', 2n * 10n ** 18n, 4) } as OwnedRecord }, { id: '1group', amount: 10n ** 18n, record: { recordPlaintext: TOKEN } as OwnedRecord }],
    }))
    await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, recordClient: { ...f.publicClient, account: f.wallet.account } as Client, merkleProof: PROOF, skipRouteStatus: true })
    const inputs = f.executeTransaction.mock.calls[0]![0].inputs
    expect(inputs[0]).toBe(TOKEN)
    expect(inputs[1]).toBe(DISPATCH)
    expect(vi.mocked(getRecordInventory)).toHaveBeenCalledWith(expect.anything(), { asset: { program: 'credits.aleo', recordName: 'credits' } })
  })

  it('derives an omitted local compliance proof for the Aleo signer', async () => {
    const f = await fixture({ local: true })
    const generateFreezelistProof = vi.fn(async () => PROOF)
    f.wallet.proving = { generateFreezelistProof } as never
    const original = f.request.getMockImplementation()!
    f.request.mockImplementation(args => args.method === 'getMappingValue' && args.params.mapping === 'freeze_list_root'
      ? Promise.resolve('3642222252059314292809609689035560016959342421640560347114299934615987159853field') : original(args))
    await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote,
      tokenRecord: TOKEN, dispatchCreditsRecord: DISPATCH, skipRouteStatus: true,
    })
    expect(generateFreezelistProof).toHaveBeenCalledWith(expect.objectContaining({ address: OWNER }))
    expect(f.executeTransaction.mock.calls[0]![0].inputs[9]).toBe(PROOF)
  })

  it('rejects an account switch during local preparation before broadcast', async () => {
    const f = await fixture({ local: true })
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, skipRouteStatus: true,
      onProgress: event => { if (event.type === 'request-built') f.wallet.account = { type: 'local', address: 'aleo1other' } as never },
    })).rejects.toThrow(/signer changed/)
    expect(f.broadcast).not.toHaveBeenCalled()
  })

  it.each(['public-input', 'record-alias', 'proof-visibility', 'plaintext-proof'])('rejects a tampered prepared transaction (%s)', async invalid => {
    const f = await fixture({ local: true, privateFee: true })
    const inputs = f.transaction.execution!.transitions[0]!.inputs!
    if (invalid === 'public-input') inputs[7]!.value = '1u128'
    if (invalid === 'record-alias') f.transaction.fee.transition.inputs![0]!.id = inputs[1]!.id
    if (invalid === 'proof-visibility') inputs[9]!.type = 'public'
    if (invalid === 'plaintext-proof') inputs[9]!.value = PROOF
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote,
      ...localFunding, privateFee: true, feeRecord: FEE, skipRouteStatus: true,
    })).rejects.toThrow(/public inputs|distinct|visibility|private data/)
    expect(f.broadcast).not.toHaveBeenCalled()
  })

  it('requires distinct local private fee funding and validates the prepared fee', async () => {
    const f = await fixture({ local: true, privateFee: true })
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, privateFee: true, feeRecord: DISPATCH, skipRouteStatus: true })).rejects.toThrow(/distinct/)
    await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, privateFee: true, feeRecord: FEE, skipRouteStatus: true })
    expect(f.executeTransaction.mock.calls[0]![0].feeRecord).toBe(FEE)
  })

  it('rejects a private execution fee record that is too small for the proved fee', async () => {
    const f = await fixture({ local: true, privateFee: true })
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, privateFee: true, feeRecord: record('microcredits', 1n, 3), skipRouteStatus: true })).rejects.toThrow(/prepared fee/)
    expect(f.broadcast).not.toHaveBeenCalled()
  })

  it('does not permit unpinned private execution fees through the wallet protocol', async () => {
    const f = await fixture()
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, privateFee: true, skipRouteStatus: true })).rejects.toThrow(/local signer/)
    expect(f.executeTransaction).not.toHaveBeenCalled()
  })

  it('preserves a submitted checkpoint when a storage callback fails after broadcast', async () => {
    const f = await fixture()
    const error = await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, skipRouteStatus: true,
      onCheckpoint: () => { throw new Error('Storage unavailable') },
    }).catch(error => error)
    expect(error).toBeInstanceOf(PrivateHyperlaneSubmissionError)
    expect(error.checkpoint.source.transactionId).toBe(TX)
    expect(error.receipt.status).toBe('SOURCE_CONFIRMING')
    expect(f.broadcast).toHaveBeenCalledOnce()
  })
})

describe('private outbound recovery', () => {
  it('checkpoints before local broadcast, then resumes the same bytes without a wallet or new records', async () => {
    const f = await fixture({ local: true })
    const saved: BridgeCheckpoint[] = []
    await expect(hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, skipRouteStatus: true,
      onCheckpoint: checkpoint => { saved.push(checkpoint); throw new Error('Crash before broadcast') },
    })).rejects.toThrow(/Crash before broadcast/)
    expect(f.broadcast).not.toHaveBeenCalled()
    expect(saved[0]!.source!.privateHyperlane).toBe(true)
    expect(JSON.stringify(saved)).not.toContain(TOKEN)
    expect(JSON.stringify(saved)).not.toContain(PROOF)
    const clients = { ...f.clients, aleo: { family: 'aleo' as const, publicClient: f.publicClient } }
    const progress = await recover(f.registry, clients, fetch, { checkpoint: saved[0]! })
    expect(progress.next).toBe('resume')
    if (progress.next !== 'resume') throw new Error('Expected resume')
    const result = await resume(f.registry, clients, { progress, skipRouteStatus: true })
    expect(result.receipt.sourceTxId).toBe(TX)
    expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'sendTransaction', params: { transaction: saved[0]!.source!.preparedTransaction!.serializedTransaction } }))
    expect(f.executeTransaction).toHaveBeenCalledOnce()
  })

  it('keeps submitted source records pending and verifies only the net destination increase', async () => {
    const f = await fixture()
    let saved: BridgeCheckpoint | undefined
    const result = await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, skipRouteStatus: true, onCheckpoint: checkpoint => { saved = checkpoint } })
    const progress = await recover(f.registry, f.clients, fetch, { checkpoint: saved! })
    expect(progress.next).toBe('wait')
    expect(progress.receipt.status).toBe('DELIVERY_PENDING')
    f.state.balance = 100n + f.quote.destinationAmountAtomic - 1n
    expect((await getStatus(f.registry, f.clients, fetch, { plan: f.plan, receipt: progress.receipt })).status).toBe('DELIVERY_PENDING')
    f.state.balance++
    expect((await getStatus(f.registry, f.clients, fetch, { plan: f.plan, receipt: progress.receipt })).status).toBe('COMPLETED')
    expect(result.receipt.protocolState.sourceFunction).toBe('transfer_remote_private')
    expect(f.executeTransaction).toHaveBeenCalledOnce()
  })

  it('retains submitted state for an unknown source outcome without rebuilding or resending', async () => {
    const f = await fixture()
    let saved: BridgeCheckpoint | undefined
    await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, skipRouteStatus: true,
      onCheckpoint: checkpoint => { saved = checkpoint },
    })
    const original = f.request.getMockImplementation()!
    f.request.mockImplementation(args => ['getConfirmedTransaction', 'getUnconfirmedTransaction'].includes(args.method)
      ? Promise.reject(new Error('Transaction not found')) : original(args))
    const progress = await recover(f.registry, f.clients, fetch, { checkpoint: saved! })
    expect(progress.next).toBe('wait')
    expect(progress.receipt.status).toBe('SOURCE_CONFIRMING')
    expect(f.executeTransaction).toHaveBeenCalledOnce()
    expect(f.request.mock.calls.some(args => args[0].method === 'sendTransaction')).toBe(false)
  })

  it('rejects recovery that replaces a marked private call with a public call', async () => {
    const f = await fixture({ local: true })
    let saved: BridgeCheckpoint | undefined
    await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, skipRouteStatus: true,
      onCheckpoint: checkpoint => { saved = checkpoint; throw new Error('Crash') },
    }).catch(() => {})
    const transaction = JSON.parse(saved!.source!.preparedTransaction!.serializedTransaction) as Transaction
    transaction.execution!.transitions[0]!.function = 'transfer_remote'
    saved!.source!.preparedTransaction!.serializedTransaction = JSON.stringify(transaction)
    const progress = await recover(f.registry, f.clients, fetch, { checkpoint: saved! })
    if (progress.next !== 'resume') throw new Error('Expected resume')
    await expect(resume(f.registry, f.clients, { progress, skipRouteStatus: true })).rejects.toThrow(/eleven-input call/)
    expect(f.request.mock.calls.some(args => args[0].method === 'sendTransaction')).toBe(false)
  })

  it('refuses to rebroadcast prepared private bytes after a fee change', async () => {
    const f = await fixture({ local: true })
    let saved: BridgeCheckpoint | undefined
    await hyperlane.aleo.executePrivateTransfer(f.clients, { registry: f.registry, plan: f.plan, quote: f.quote, ...localFunding, skipRouteStatus: true,
      onCheckpoint: checkpoint => { saved = checkpoint; throw new Error('Crash') },
    }).catch(() => {})
    const progress = await recover(f.registry, f.clients, fetch, { checkpoint: saved! })
    if (progress.next !== 'resume') throw new Error('Expected resume')
    f.state.rate = '26u16'
    f.request.mockClear()
    await expect(resume(f.registry, f.clients, { progress, skipRouteStatus: true })).rejects.toThrow(/net delivery|public inputs/)
    expect(f.request.mock.calls.some(args => args[0].method === 'sendTransaction')).toBe(false)
  })
})
