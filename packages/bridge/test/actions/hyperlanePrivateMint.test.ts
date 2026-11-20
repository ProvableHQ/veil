import { describe, expect, it, vi } from 'vitest'
import { prepare } from '../../src/actions/prepare.js'
import { quote } from '../../src/actions/quote.js'
import { complete } from '../../src/actions/complete.js'
import { getStatus } from '../../src/actions/getStatus.js'
import { recover } from '../../src/actions/recover.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { hyperlanePrivateClaimGrants } from '../../src/protocols/hyperlane/privateMint.js'
import { hyperlaneCommitmentToLimbs } from '../../src/utils/hyperlane.js'
import { deriveXReservePrivateMintAddressCommitment } from '../../src/utils/xreserve.js'
import type { BridgeReceipt, PrepareParameters } from '../../src/types/protocol.js'
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

  it('does not query or claim funds before message delivery', async () => {
    const { clients, request } = fixture({ delivered: false })
    expect(await getStatus(registry, clients, fetch, { plan, receipt: pending })).toBe(pending)
    expect(request).toHaveBeenCalledOnce()
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
