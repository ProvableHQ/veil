import { describe, expect, it, vi } from 'vitest'
import { prepare } from '../../src/actions/prepare.js'
import { quote } from '../../src/actions/quote.js'
import { complete } from '../../src/actions/complete.js'
import { getStatus } from '../../src/actions/getStatus.js'
import { recover } from '../../src/actions/recover.js'
import { resume } from '../../src/actions/resume.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { hyperlanePrivateClaimGrants, readHyperlaneClaimableAmount, scanHyperlaneAddressEncodings } from '../../src/protocols/hyperlane/privateMint.js'
import { hyperlaneCommitmentToLimbs } from '../../src/utils/hyperlane.js'
import { deriveXReservePrivateMintAddressCommitment } from '../../src/utils/xreserve.js'
import type { BridgeCheckpoint, BridgeReceipt, PrepareParameters } from '../../src/types/protocol.js'
import type { AleoWalletClient } from '../../src/types/aleo.js'
import { COMMITMENT_HEX, withPrivateMint } from '../fixtures/privateHyperlane.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const ROUTE = 'hyperlane:ethereum/eth->aleo/eth'
const registry = withPrivateMint(DEFAULT_BRIDGE_REGISTRY, ROUTE)
const intent: PrepareParameters = {
  source: { chain: 'ethereum', asset: 'eth' }, destination: { chain: 'aleo', asset: 'eth' },
  amount: '0.0000000000000001', recipient: RECIPIENT,
  hyperlane: { addressEncoding: { commitmentHex: COMMITMENT_HEX } },
}
const plan = prepare(registry, intent)
const pending: BridgeReceipt = {
  id: `0x${'22'.repeat(32)}`, sourceTxId: `0x${'33'.repeat(32)}`, messageId: `0x${'22'.repeat(32)}`,
  protocol: 'hyperlane', status: 'DELIVERY_PENDING', protocolState: { routeId: ROUTE },
}

function fixture(options: { balance?: unknown; delivered?: boolean; confirmed?: string; local?: boolean } = {}) {
  const request = vi.fn(async ({ method, params }: { method: string; params: Record<string, unknown> }) => {
    if (method === 'getMappingValue' && params.mapping === 'deliveries') return options.delivered === false ? null : 'true'
    if (method === 'getMappingValue' && params.mapping === 'claimable') return options.balance === undefined ? '100u128' : options.balance
    if (method === 'getConfirmedTransaction') return { status: options.confirmed ?? 'accepted' }
    throw new Error(`Unexpected ${method}`)
  })
  const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1claim')
  const wallet: AleoWalletClient = { executeTransaction,
    ...(options.local ? { account: { type: 'local', address: RECIPIENT } as never } : {}),
  }
  const clients = { aleo: { family: 'aleo' as const, publicClient: { request } as never, walletClient: wallet } }
  return { clients, request, executeTransaction }
}

describe('Hyperlane private delivery', () => {
  it('matches the canonical little-endian commitment limbs', () => {
    expect(hyperlaneCommitmentToLimbs({ commitmentHex: COMMITMENT_HEX })).toEqual([
      21345817372864405881847059188222722561n, 42696867846335054569745073772176806417n,
    ])
  })

  it.each(['', '11'.repeat(31), 'AA'.repeat(32), `0x${COMMITMENT_HEX}`, 'gg'.repeat(32)])('rejects malformed encoding %s before network access', async commitmentHex => {
    const { clients, request } = fixture()
    await expect(quote(registry, clients, { ...intent, hyperlane: { addressEncoding: { commitmentHex } } })).rejects.toThrow(/commitmentHex/)
    expect(request).not.toHaveBeenCalled()
  })

  it('requires reviewed deployment metadata without changing existing public routes', () => {
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, intent)).toThrow(/reviewed private claim metadata/)
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, { ...intent, hyperlane: undefined })).not.toThrow()
    expect(() => prepare(registry, { ...intent, hyperlane: undefined, mintMode: 'private' })).toThrow(/commitmentHex/)
    expect(() => prepare(registry, { ...intent, mintMode: 'public' })).toThrow(/private inbound/)
    expect(() => prepare(registry, { ...intent, mintMode: 'record' })).toThrow(/only supported by xReserve/)
    expect(() => prepare(registry, { ...intent, amount: '340282366920938463464' })).toThrow(/u128/)
  })

  it.each(['privateMintEncoding', 'privateMintAbi', 'privateMintProgram', 'privateMintMapping', 'privateMintFreezelistProgram', 'privateMintCommit', 'destinationRouter', 'aleoMailboxProgram'])(
    'refuses private delivery when %s is missing or mismatched', key => {
      const altered = { ...registry, routes: registry.routes.map(route => route.id === ROUTE
        ? { ...route, metadata: { ...route.metadata, [key]: '' } } : route) }
      expect(() => prepare(altered, intent)).toThrow(/reviewed private claim metadata/)
    },
  )

  it('rejects public plans at private claim and grant entry points before network access', async () => {
    const publicPlan = prepare(registry, { ...intent, hyperlane: undefined })
    const { clients, request, executeTransaction } = fixture()
    expect(() => hyperlanePrivateClaimGrants({ registry, plan: publicPlan })).toThrow(/private plan/)
    await expect(complete(registry, clients, { plan: publicPlan, receipt: { ...pending, status: 'DESTINATION_ACTION_REQUIRED' }, skipRouteStatus: true })).rejects.toThrow(/private plan/)
    expect(request).not.toHaveBeenCalled()
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('binds separate wallet grants to the claim slots', () => {
    expect(hyperlanePrivateClaimGrants({ registry, plan })).toEqual([
      { algorithm: 'hyperlane-claim-secret', program: 'test_hyp_warp_token_eth_v2.aleo', function: 'claim_private', inputPosition: 3 },
      { algorithm: 'program-freezelist-exclusion-proof', program: 'test_hyp_warp_token_eth_v2.aleo', function: 'claim_private', inputPosition: 4, argConstraints: { freezelistProgram: ['shield_arc22_freezelist.aleo'] } },
    ])
  })

  it('stops at claim authorization after delivery instead of reporting completed', async () => {
    const { clients, request } = fixture()
    const receipt = await getStatus(registry, clients, fetch, { plan, receipt: pending })
    expect(receipt.status).toBe('DESTINATION_ACTION_REQUIRED')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ params: {
      programId: 'test_hyp_warp_token_eth_v2.aleo', mapping: 'claimable',
      key: '[21345817372864405881847059188222722561u128, 42696867846335054569745073772176806417u128]',
    } }))
  })

  it.each([null, '0u128', '99u128'])('keeps delivery pending for insufficient claimable balance %s', async balance => {
    const { clients } = fixture({ balance })
    expect((await getStatus(registry, clients, fetch, { plan, receipt: pending })).status).toBe('DELIVERY_PENDING')
  })

  it.each(['-1u128', '1u64', '340282366920938463463374607431768211456u128', {}, 'bad'])('rejects malformed claimable values %s', async balance => {
    const { clients } = fixture({ balance })
    await expect(getStatus(registry, clients, fetch, { plan, receipt: pending })).rejects.toThrow(/Malformed/)
  })

  it('uses claimable state without requiring a message id or mailbox read', async () => {
    const { clients, request } = fixture({ delivered: false })
    const { messageId: _messageId, ...receipt } = pending
    expect((await getStatus(registry, clients, fetch, { plan, receipt })).status).toBe('DESTINATION_ACTION_REQUIRED')
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]![0].params.mapping).toBe('claimable')
  })

  it('submits the five-input ABI with recipient-bound derived requests and saves only public state', async () => {
    const { clients, executeTransaction } = fixture()
    const ready = await getStatus(registry, clients, fetch, { plan, receipt: pending })
    const checkpoint = vi.fn()
    const result = await complete(registry, clients, { plan, receipt: ready, skipRouteStatus: true, onCheckpoint: checkpoint })
    expect(result.kind).toBe('aleo-hyperlane')
    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      program: 'test_hyp_warp_token_eth_v2.aleo', function: 'claim_private', privateFee: false,
      inputs: [
        '[21345817372864405881847059188222722561u128, 42696867846335054569745073772176806417u128]', '100u128', RECIPIENT,
        { type: 'derived', algorithm: 'hyperlane-claim-secret', args: {
          commitment: { type: 'string', value: COMMITMENT_HEX }, recipient: { type: 'address', value: RECIPIENT },
        } },
        { type: 'derived', algorithm: 'program-freezelist-exclusion-proof', args: {
          freezelistProgram: { type: 'string', value: 'shield_arc22_freezelist.aleo' }, address: { type: 'address', value: RECIPIENT },
        } },
      ],
    }))
    expect(result.receipt).toMatchObject({ status: 'DESTINATION_CONFIRMING', destinationTxId: 'at1claim' })
    expect(checkpoint.mock.calls[0]![0].intent.hyperlane).toEqual(intent.hyperlane)
    expect(JSON.stringify(checkpoint.mock.calls)).not.toMatch(/hyperlane-claim-secret|secretNonce|merkleProof/)
    expect((await getStatus(registry, clients, fetch, { plan, receipt: result.receipt })).status).toBe('COMPLETED')
  })

  it('rechecks claimable funds before asking the wallet', async () => {
    const { clients, executeTransaction } = fixture({ balance: '99u128' })
    await expect(complete(registry, clients, { plan, receipt: { ...pending, status: 'DESTINATION_ACTION_REQUIRED' }, skipRouteStatus: true })).rejects.toThrow(/not funded/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('retains the original commitment after rejection so a claim can be retried', async () => {
    const { clients } = fixture({ confirmed: 'rejected' })
    const receipt = await getStatus(registry, clients, fetch, { plan, receipt: { ...pending, status: 'DESTINATION_CONFIRMING', destinationTxId: 'at1rejected' } })
    expect(receipt.status).toBe('DESTINATION_ACTION_REQUIRED')
    expect(createBridgeCheckpoint(plan, receipt).intent.hyperlane).toEqual(intent.hyperlane)
  })

  it('requires explicit local private inputs instead of passing unresolved wallet requests', async () => {
    const { clients, executeTransaction } = fixture({ local: true })
    await expect(complete(registry, clients, { plan, receipt: { ...pending, status: 'DESTINATION_ACTION_REQUIRED' }, skipRouteStatus: true })).rejects.toThrow(/Local Hyperlane claims require/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('validates the local scalar against the commitment before submitting', async () => {
    const commitmentHex = await deriveXReservePrivateMintAddressCommitment(RECIPIENT, '123scalar', 'mainnet')
    const localPlan = prepare(registry, { ...intent, hyperlane: { addressEncoding: { commitmentHex } } })
    const { clients, executeTransaction } = fixture({ local: true })
    const params = { plan: localPlan, receipt: { ...pending, status: 'DESTINATION_ACTION_REQUIRED' as const }, skipRouteStatus: true }
    await expect(complete(registry, clients, { ...params, hyperlane: { secretNonce: '124scalar', merkleProof: '[...]' } })).rejects.toThrow(/does not match/)
    expect(executeTransaction).not.toHaveBeenCalled()
    await complete(registry, clients, { ...params, hyperlane: { secretNonce: '123scalar', merkleProof: '[...]' } })
    expect(executeTransaction.mock.calls[0]![0].inputs[3]).toBe('123scalar')
  })

  it('recovers an already submitted EVM-to-Aleo claim without repeating it', async () => {
    const { clients, executeTransaction } = fixture()
    const checkpoint = createBridgeCheckpoint(plan, { ...pending, status: 'DESTINATION_CONFIRMING', destinationTxId: 'at1claim' })
    const progress = await recover(registry, { ...clients, ethereum: { family: 'evm', publicClient: {
      getChainId: async () => 1,
      getTransactionReceipt: async () => ({ status: 'success', logs: [] }),
    } as never } }, fetch, { checkpoint })
    expect(progress.plan.hyperlane).toEqual(intent.hyperlane)
    expect(progress.receipt.destinationTxId).toBe('at1claim')
    expect(progress.next).toBe('done')
    expect(executeTransaction).not.toHaveBeenCalled()
  })
})


describe('Hyperlane mapping recovery and counter discovery', () => {
  function checkpoint(): BridgeCheckpoint {
    // Only the intent and reviewed route survive; source ids and message ids are unavailable.
    const { source: _source, ...saved } = createBridgeCheckpoint(plan, pending)
    return saved
  }

  it('recovers funded encodings from Aleo without a source client or Circle HTTP requests', async () => {
    const { clients, request, executeTransaction } = fixture()
    const fetcher = vi.fn(async () => { throw new Error('No Circle or off-chain recovery lookup is allowed') })
    const progress = await recover(registry, clients, fetcher, { checkpoint: checkpoint() })
    expect(progress.next).toBe('complete')
    expect(progress.plan.hyperlane).toEqual(plan.hyperlane)
    expect(request).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    expect(executeTransaction).not.toHaveBeenCalled()
    if (progress.next !== 'complete') throw new Error('Expected claim authorization')
    await complete(registry, clients, { progress, skipRouteStatus: true })
    expect(executeTransaction).toHaveBeenCalledOnce()
  })

  it.each(['SOURCE_APPROVAL_PENDING', 'SOURCE_SUBMISSION_PENDING', 'SOURCE_CONFIRMING'] as const)(
    'uses a funded mapping before requiring source access for %s', async status => {
      const { clients, request } = fixture()
      const receipt = await getStatus(registry, clients, fetch, { plan, receipt: { ...pending, status } })
      expect(receipt.status).toBe('DESTINATION_ACTION_REQUIRED')
      expect(request).toHaveBeenCalledOnce()
      expect(request.mock.calls[0]![0].params.mapping).toBe('claimable')
    },
  )

  it('waits on an absent mapping without requiring an unavailable source client', async () => {
    const { clients } = fixture({ balance: null })
    const progress = await recover(registry, clients, fetch, { checkpoint: createBridgeCheckpoint(plan, pending) })
    expect(progress.next).toBe('wait')
    expect(progress.receipt.sourceTxId).toBe(pending.sourceTxId)
  })

  it('recovers a funded commitment even when source history is unavailable', async () => {
    const { clients } = fixture()
    const getTransactionReceipt = vi.fn(async () => { throw new Error('Source history unavailable') })
    const progress = await recover(registry, { ...clients, ethereum: { family: 'evm', publicClient: { getTransactionReceipt } as never } }, fetch, {
      checkpoint: createBridgeCheckpoint(plan, pending),
    })
    expect(progress.next).toBe('complete')
    expect(progress.receipt.sourceTxId).toBe(pending.sourceTxId)
    expect(getTransactionReceipt).not.toHaveBeenCalled()
  })

  it.each([null, '0u128', '99u128'])('does not infer completion or authorize claims for mapping value %s', async balance => {
    const { clients, executeTransaction } = fixture({ balance })
    const progress = await recover(registry, clients, fetch, { checkpoint: checkpoint() })
    expect(progress.next).toBe('wait')
    expect(progress.receipt.status).toBe('DELIVERY_PENDING')
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('keeps recognized zero-balance identities away from source resubmission', async () => {
    const { clients } = fixture({ balance: '0u128' })
    const saved = checkpoint()
    saved.source = { approvalTransactionIds: [`0x${'44'.repeat(32)}`] }
    const progress = await recover(registry, clients, fetch, { checkpoint: saved })
    expect(progress.next).toBe('wait')
    expect(progress.receipt.protocolState.approvalTxIds).toEqual(saved.source.approvalTransactionIds)
  })

  it.each(['100u128', '0u128'])('does not redispatch stale source progress for recognized mapping value %s', async balance => {
    const { clients, executeTransaction } = fixture({ balance })
    const result = await resume(registry, clients, {
      progress: { next: 'resume', plan, receipt: { ...pending, status: 'SOURCE_SUBMISSION_PENDING',
        protocolState: { routeId: ROUTE, approvalTxIds: [`0x${'44'.repeat(32)}`] },
      } }, skipRouteStatus: true,
    })
    expect(result.receipt.status).toBe(balance === '100u128' ? 'DESTINATION_ACTION_REQUIRED' : 'DELIVERY_PENDING')
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('waits for a submitted claim even when claimable funds remain available', async () => {
    const { clients, executeTransaction } = fixture({ confirmed: 'pending' })
    const saved = checkpoint()
    saved.destination = { transactionId: 'at1pending' }
    const progress = await recover(registry, clients, fetch, { checkpoint: saved })
    expect(progress.next).toBe('wait')
    expect(progress.receipt.destinationTxId).toBe('at1pending')
    expect(progress.receipt.status).toBe('DESTINATION_CONFIRMING')
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it.each(['0u128', null])('rechecks the mapping after a rejected claim with balance %s', async balance => {
    const { clients } = fixture({ confirmed: 'rejected', balance })
    const saved = checkpoint()
    saved.destination = { transactionId: 'at1rejected' }
    const progress = await recover(registry, clients, fetch, { checkpoint: saved })
    expect(progress.next).toBe('wait')
    expect(progress.receipt.status).toBe('DELIVERY_PENDING')
  })

  it('normalizes a backend string null as an absent encoding', async () => {
    const { clients } = fixture({ balance: 'null' })
    expect(await readHyperlaneClaimableAmount(registry, clients, { routeId: ROUTE, addressEncoding: plan.hyperlane!.addressEncoding })).toBeNull()
  })

  it('distinguishes a recognized zero balance from an absent encoding', async () => {
    const present = fixture({ balance: '0u128' })
    const absent = fixture({ balance: null })
    const params = { routeId: ROUTE, addressEncoding: plan.hyperlane!.addressEncoding }
    expect(await readHyperlaneClaimableAmount(registry, present.clients, params)).toBe(0n)
    expect(await readHyperlaneClaimableAmount(registry, absent.clients, params)).toBeNull()
  })

  it('scans across unused counters and recovers zero and positive entries with public data only', async () => {
    const { clients, request } = fixture()
    const encoding = (counter: number) => ({ commitmentHex: counter.toString(16).padStart(2, '0') + '00'.repeat(31) })
    request.mockImplementation(async ({ params }) => {
      if (params.key === '[1u128, 0u128]') return '0u128'
      if (params.key === '[3u128, 0u128]') return '250u128'
      return null
    })
    const derive = vi.fn(encoding)
    const result = await scanHyperlaneAddressEncodings(registry, clients, { routeId: ROUTE, deriveAddressEncoding: derive, maxCounters: 5 })
    expect(result).toEqual({ entries: [
      { counter: 1, addressEncoding: encoding(1), claimableAmount: 0n },
      { counter: 3, addressEncoding: encoding(3), claimableAmount: 250n },
    ], nextCounter: 5 })
    expect(derive.mock.calls.map(args => args[0])).toEqual([0, 1, 2, 3, 4])
    expect(request.mock.calls.every(args => args[0].method === 'getMappingValue' && args[0].params.mapping === 'claimable')).toBe(true)
    expect(Object.keys(result.entries[0]!)).toEqual(['counter', 'addressEncoding', 'claimableAmount'])
    const continuation = await scanHyperlaneAddressEncodings(registry, clients, { routeId: ROUTE, deriveAddressEncoding: derive, startCounter: result.nextCounter, maxCounters: 2 })
    expect(continuation.nextCounter).toBe(7)
    expect(derive.mock.calls.slice(-2).map(args => args[0])).toEqual([5, 6])
  })

  it('returns the bytes actually queried when the derivation object changes during a read', async () => {
    const { clients, request } = fixture()
    const candidate = { commitmentHex: COMMITMENT_HEX }
    request.mockImplementationOnce(async () => { candidate.commitmentHex = '22'.repeat(32); return '100u128' })
    const result = await scanHyperlaneAddressEncodings(registry, clients, { routeId: ROUTE, deriveAddressEncoding: () => candidate, maxCounters: 1 })
    expect(result.entries[0]!.addressEncoding.commitmentHex).toBe(COMMITMENT_HEX)
  })

  it('stops at the u32 counter boundary without wrapping or reissuing an identity', async () => {
    const { clients } = fixture({ balance: null })
    const derive = vi.fn(() => plan.hyperlane!.addressEncoding)
    const result = await scanHyperlaneAddressEncodings(registry, clients, { routeId: ROUTE, deriveAddressEncoding: derive, startCounter: 0xffff_ffff, maxCounters: 2 })
    expect(derive).toHaveBeenCalledExactlyOnceWith(0xffff_ffff)
    expect(result).toEqual({ entries: [], nextCounter: undefined })
  })

  it.each([{ startCounter: -1 }, { startCounter: 0x1_0000_0000 }, { startCounter: 0.5 }, { maxCounters: 0 }, { maxCounters: 100_001 }])(
    'rejects invalid scan bounds %s before deriving or reading', async bounds => {
      const { clients, request } = fixture()
      const derive = vi.fn(() => plan.hyperlane!.addressEncoding)
      await expect(scanHyperlaneAddressEncodings(registry, clients, { routeId: ROUTE, deriveAddressEncoding: derive, ...bounds })).rejects.toThrow(/counter range/)
      expect(derive).not.toHaveBeenCalled()
      expect(request).not.toHaveBeenCalled()
    },
  )

  it('rejects unreviewed routes before invoking the derivation callback', async () => {
    const { clients, request } = fixture()
    const derive = vi.fn(() => plan.hyperlane!.addressEncoding)
    await expect(scanHyperlaneAddressEncodings(DEFAULT_BRIDGE_REGISTRY, clients, { routeId: ROUTE, deriveAddressEncoding: derive })).rejects.toThrow(/reviewed/)
    expect(derive).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('propagates mapping failures without treating them as gaps or advancing the scan', async () => {
    const { clients, request } = fixture()
    request.mockRejectedValueOnce(new Error('Aleo temporarily unavailable'))
    const derive = vi.fn(() => plan.hyperlane!.addressEncoding)
    await expect(scanHyperlaneAddressEncodings(registry, clients, { routeId: ROUTE, deriveAddressEncoding: derive, maxCounters: 2 })).rejects.toThrow(/temporarily unavailable/)
    expect(derive).toHaveBeenCalledOnce()
  })

  it('observes cancellation after derivation before reading or checking another counter', async () => {
    const { clients, request } = fixture()
    const controller = new AbortController()
    const derive = vi.fn(() => { controller.abort(); return plan.hyperlane!.addressEncoding })
    await expect(scanHyperlaneAddressEncodings(registry, clients, { routeId: ROUTE, deriveAddressEncoding: derive, signal: controller.signal })).rejects.toThrow(/abort/i)
    expect(request).not.toHaveBeenCalled()
    expect(derive).toHaveBeenCalledOnce()
  })
})
