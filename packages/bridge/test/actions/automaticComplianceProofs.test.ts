import { describe, expect, it, vi } from 'vitest'
import { createClient, type Client, type FreezelistProofInput } from '@provablehq/veil-core'
import { createAleoClient } from '../../src/connections/aleo.js'
import { unshield } from '../../src/actions/unshield.js'
import { execute } from '../../src/actions/execute.js'
import { prepare } from '../../src/actions/prepare.js'
import { buildXReserveBurnCall } from '../../src/builders/buildXReserveBurnCall.js'
import { DEFAULT_BRIDGE_REGISTRY as registry } from '../../src/registry/default.js'
import type { AleoWalletClient, UnshieldParameters } from '../../src/types/aleo.js'

const asset = { chain: 'aleo', asset: 'usdcx' }
const signer = 'aleo1signer'
const list = 'usdcx_freezelist.aleo'
const record = '{ owner: aleo1signer.private, amount: 2500000u128.private }'
const derived = {
  type: 'derived', algorithm: 'program-freezelist-exclusion-proof',
  args: { freezelistProgram: { type: 'string', value: list } },
}
const plan = () => prepare(registry, {
  source: asset, destination: { chain: 'ethereum', asset: 'usdc' },
  amount: '2.5', recipient: '0x0000000000000000000000000000000000000001',
})

function local() {
  let root = '123field'
  const request = vi.fn(async ({ method }: { method: string }) =>
    method === 'getMappingValue' ? root : ['0', '1', root.slice(0, -5)])
  const generate = vi.fn(async ({ address, root }: { address: string; root: string }) => `[${address}:${root}]`)
  const base = createClient({
    account: { type: 'local', address: signer } as Client['account'],
    transport: { request, config: { key: 'test', name: 'test', type: 'test', request, network: 'mainnet' } },
    proving: { generateFreezelistProof: generate } as unknown as Client['proving'],
  })
  const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1test')
  const wallet = Object.assign(base, { executeTransaction })
  const clients = { aleo: createAleoClient({ publicClient: base, account: wallet }) }
  const convert = (merkleProof?: UnshieldParameters['merkleProof']) => unshield(registry, clients, {
    asset, amount: '2.5', record, recipient: signer, merkleProof,
  })
  return { wallet, clients, convert, request, generate, executeTransaction, setRoot: (value: string) => { root = value } }
}

describe('automatic bridge compliance proofs', () => {
  it.each([undefined, null])('fills wallet unshield and private-burn inputs for %s', async (merkleProof) => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1wallet')
    const clients = { aleo: createAleoClient({ publicClient: {} as Client, account: { executeTransaction } }) }
    await unshield(registry, clients, { asset, amount: '2.5', merkleProof })
    await execute(registry, clients, { plan: plan(), userRecord: record, merkleProof })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toEqual(derived)
    expect(executeTransaction.mock.calls[1]?.[0].inputs?.[4]).toEqual(derived)
  })

  it('builds a wallet proof request without a client or network access', () => {
    expect(buildXReserveBurnCall(registry, { plan: plan(), userRecord: record }).inputs[4]).toEqual(derived)
  })

  it('generates against the current root, shares witnesses across operations, and invalidates changed roots', async () => {
    const { clients, convert, request, generate, executeTransaction, setRoot } = local()
    await convert()
    await execute(registry, clients, { plan: plan(), userRecord: record })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toBe('[aleo1signer:123field]')
    expect(executeTransaction.mock.calls[1]?.[0].inputs?.[4]).toBe('[aleo1signer:123field]')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map(([p]) => p.method)).toEqual(['getMappingValue', 'getComplianceFreezeList', 'getMappingValue'])
    setRoot('456field')
    await convert(null)
    expect(executeTransaction.mock.calls[2]?.[0].inputs?.[3]).toBe('[aleo1signer:456field]')
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('uses the signer rather than the public unshield recipient', async () => {
    const { clients, generate } = local()
    await unshield(registry, clients, { asset, amount: '2.5', record, recipient: 'aleo1recipient' })
    expect(generate).toHaveBeenCalledWith({ address: signer, tree: ['0', '1', '123'], root: '123field' })
  })

  it('constructs a verified empty-tree witness without downloading a tree', async () => {
    const { convert, setRoot, generate, request } = local()
    const root = '3642222252059314292809609689035560016959342421640560347114299934615987159853field'
    setRoot(root)
    await convert()
    expect(generate).toHaveBeenCalledWith({ address: signer, tree: [], root })
    expect(request.mock.calls.map(([p]) => p.method)).toEqual(['getMappingValue'])
  })

  it('shares concurrent generation and separates client, signer, and network caches', async () => {
    const { convert, wallet, generate } = local()
    await Promise.all([convert(), convert()])
    expect(generate).toHaveBeenCalledTimes(1)
    wallet.account = { ...wallet.account!, address: 'aleo1other' }
    await convert()
    expect(generate).toHaveBeenCalledTimes(2)
    wallet.transport.config.network = 'testnet'
    await convert()
    expect(generate).toHaveBeenCalledTimes(3)
    const other = local()
    await other.convert()
    expect(other.generate).toHaveBeenCalledTimes(1)
  })

  it('evicts a failed witness and never submits a frozen or stale proof', async () => {
    const { convert, generate, request, executeTransaction } = local()
    generate.mockRejectedValueOnce(new Error('Address is frozen'))
    await expect(convert()).rejects.toThrow('Address is frozen')
    expect(executeTransaction).not.toHaveBeenCalled()
    await convert()
    expect(request.mock.calls.filter(([p]) => p.method === 'getComplianceFreezeList')).toHaveLength(2)
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toBe('[aleo1signer:123field]')
  })

  it.each([
    '[cached]',
    ['[cached]'] as const,
    [{ freezelistProgram: list, address: signer, proof: '[cached]' }],
    async () => '[cached]',
  ])('uses supplied proofs without reading a root or downloading a list', async (merkleProof) => {
    const { clients, convert, request, executeTransaction } = local()
    await convert(merkleProof)
    await execute(registry, clients, { plan: plan(), userRecord: record, merkleProof })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toBe('[cached]')
    expect(executeTransaction.mock.calls[1]?.[0].inputs?.[4]).toBe('[cached]')
    expect(request).not.toHaveBeenCalled()
  })

  it('passes the reviewed list and signer to a provider and formats its Merkle pair', async () => {
    const { convert, executeTransaction } = local()
    const path = { siblings: Array(16).fill('0field'), leaf_index: 1 }
    const provider = vi.fn(async () => [path, path] as const)
    await convert(provider)
    expect(provider).toHaveBeenCalledWith({ freezelistProgram: list, address: signer })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toBe(
      `[{ siblings: [${Array(16).fill('0field').join(', ')}], leaf_index: 1u32 }, { siblings: [${Array(16).fill('0field').join(', ')}], leaf_index: 1u32 }]`,
    )
  })

  it.each([[], ['[one]', '[two]'], [{ freezelistProgram: list, address: 'aleo1other', proof: '[wrong]' }]].map(merkleProof => ({ merkleProof })))('rejects missing or excess bundles before submission', async ({ merkleProof }) => {
    const { convert, executeTransaction } = local()
    await expect(convert(merkleProof as UnshieldParameters['merkleProof'])).rejects.toThrow(/one|1|Missing proof/i)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('rejects wallet requests on local accounts, including provider results', async () => {
    const { convert, executeTransaction } = local()
    await expect(convert(derived as FreezelistProofInput)).rejects.toThrow(/local.*wallet/i)
    await expect(convert(async () => derived as FreezelistProofInput)).rejects.toThrow(/local.*wallet/i)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('rejects missing generators and invalid chain roots before submission', async () => {
    const { wallet, convert, setRoot, generate, executeTransaction } = local()
    setRoot('not-a-root')
    await expect(convert()).rejects.toThrow(/root/i)
    wallet.proving = undefined
    await expect(convert()).rejects.toThrow(/generat|proving/i)
    expect(generate).not.toHaveBeenCalled()
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('validates a burn before invoking its proof provider', async () => {
    const { clients, executeTransaction } = local()
    const provider = vi.fn(async () => '[cached]')
    await expect(execute(registry, clients, { plan: plan(), merkleProof: provider })).rejects.toThrow(/userRecord/)
    expect(provider).not.toHaveBeenCalled()
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('ignores compliance inputs for public burns', async () => {
    const { clients, request, executeTransaction } = local()
    await execute(registry, clients, { plan: plan(), mode: 'public', merkleProof: [] })
    expect(executeTransaction.mock.calls[0]?.[0].inputs).toHaveLength(3)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects providers in the offline builder with execution guidance', () => {
    expect(() => buildXReserveBurnCall(registry, { plan: plan(), userRecord: record, merkleProof: async () => '[proof]' }))
      .toThrow(/execut/i)
  })

  it('rejects malformed tree snapshots and refetches them after failure', async () => {
    const { convert, request, executeTransaction } = local()
    request.mockResolvedValueOnce('123field').mockResolvedValueOnce(['bad'])
    await expect(convert()).rejects.toThrow(/tree/i)
    expect(executeTransaction).not.toHaveBeenCalled()
    await convert()
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toBe('[aleo1signer:123field]')
  })

  it('uses only the current registry for automatic proofs', async () => {
    const { clients, request, executeTransaction } = local()
    const saved = plan()
    saved.sourceAsset = { ...saved.sourceAsset, privacy: { kind: 'arc22', program: 'evil.aleo', freezelistProgram: 'evil.aleo' } }
    await execute(registry, clients, { plan: saved, userRecord: record })
    expect(request.mock.calls[0]?.[0]).toMatchObject({ params: { programId: list, mapping: 'freeze_list_root', key: '1u8' } })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[4]).toBe('[aleo1signer:123field]')
  })
})
