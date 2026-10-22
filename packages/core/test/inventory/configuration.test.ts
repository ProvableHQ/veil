import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createClient, createWalletClient, memoryRecordInventoryStore, recordActions, reservedRecordIds, type RecordManagementConfig } from '../../src/index.js'

import { walletActions } from '../../src/clients/decorators/wallet.js'

const asset = { program: 'credits.aleo', standard: 'credits' } as const
const account = { type: 'rpc' as const, address: 'aleo1owner', sign: vi.fn(), signMessage: vi.fn() }
const scope = JSON.stringify(['aleo:testnet', account.address])
const record = (nonce: number) => ({
  programName: asset.program, recordName: 'credits', uid: `wallet-${nonce}`, commitment: `${nonce}field`,
  recordView: { fields: { $nonce: `${nonce}group`, microcredits: '100000u64' } },
})
function transport(network: 'testnet' | undefined = 'testnet') {
  const request = vi.fn(async ({ method }: any) => {
    if (method === 'getProgram') return readFileSync(new URL('../fixtures/programs/credits.aleo', import.meta.url), 'utf8')
    if (method === 'requestRecords') return [record(1), record(2)]
    if (method === 'executeTransaction') return 'at1wallet'
    if (method === 'getConfirmedTransaction') return { status: 'accepted', transaction: {
      id: 'at1wallet', type: 'execute', execution: { transitions: [{
        id: 'au1split', program: asset.program, function: 'split', outputs: [{ type: 'record', value: 'record1output' }],
      }] },
    } }
    throw new Error(`Unexpected request: ${method}`)
  })
  return { config: { type: 'custom', key: 'test', name: 'Test', network, request }, request }
}
const pinned = { program: asset.program, function: 'split', inputs: [{ type: 'record' as const, program: asset.program, recordname: 'credits', uid: 'wallet-1' }, '10000u64'] }

describe('explicit record management configuration', () => {
  it.each([undefined, false].flatMap((enabled) =>
    (['writeContract', 'executeTransaction', 'executeContract'] as const).map((action) => ({ enabled, action }))))(
    'keeps $action unchanged when management is $enabled, even with recordActions', async ({ enabled, action }) => {
    const store = memoryRecordInventoryStore()
    const client = createWalletClient({ account, transport: transport(),
      ...(enabled === undefined ? {} : { recordManagement: { enabled, store, chainId: 'aleo:testnet' } }),
    }).extend(recordActions({ store, chainId: 'aleo:testnet', maxFeeMicrocredits: 0n }))
    // These inputs are accepted by an unmanaged wallet; coordination would reject both.
    const result = await client[action]({ program: asset.program, function: 'join',
      inputs: ['record1ciphertext', { type: 'record', program: asset.program, recordname: 'credits' }], privateFee: true,
    })
    if (action === 'executeContract') expect(result).toMatchObject({ transactionId: 'at1wallet', outputs: ['record1output'] })
    else expect(result).toBe('at1wallet')
    expect(await store.list(scope)).toEqual([])
    expect(await reservedRecordIds(client)).toEqual(new Set())
  })

  it('adds methods without needing a chain or creating a journal', async () => {
    const rpc = transport()
    rpc.config.network = undefined
    const base = createWalletClient({ account, transport: rpc })
    const client = base.extend(recordActions())
    expect(client.recordManagement).toBeUndefined()
    expect(client.writeContract).toBe(base.writeContract)
    await expect(client.writeContract({ program: asset.program, function: 'join', inputs: [], privateFee: true })).resolves.toBe('at1wallet')
  })

  it('exposes reads, plans, native joins, and splits through walletActions while disabled', async () => {
    const client = createWalletClient({ account, transport: transport(), recordManagement: { enabled: false, chainId: 'aleo:testnet' } })
    const inventory = await client.getRecordInventory({ asset })
    expect(inventory.available).toHaveLength(2)
    expect(inventory.reserved).toEqual([])
    const plan = await client.planRecordInventory({ asset, target: { records: 1 } })
    expect(plan.scope).toBe(scope)
    expect(plan.steps).toHaveLength(1)
    await expect(client.joinRecords({ asset, records: inventory.available })).resolves.toBe('at1wallet')
    await expect(client.splitRecord({ asset, record: inventory.available[0]!, amount: 10000n })).resolves.toBe('at1wallet')
    expect(client.recordManagement?.store).toBeUndefined()
    await expect(client.rebalanceRecordInventory({ plan })).rejects.toThrow('recordManagement')
    await expect(client.reconcileRecordInventory()).rejects.toThrow('recordManagement')
  })

  it.each((['wallet', 'base'] as const).flatMap((factory) =>
    (['writeContract', 'executeTransaction', 'executeContract'] as const).map((action) => ({ factory, action }))))(
    'journals $action when explicitly enabled on the $factory factory before action binding', async ({ factory, action }) => {
    const store = memoryRecordInventoryStore()
    const config = { account, transport: transport(), recordManagement: { enabled: true, store, chainId: 'aleo:testnet' } satisfies RecordManagementConfig }
    const client = factory === 'wallet' ? createWalletClient(config) : createClient(config).extend(walletActions)
    const result = await client[action](pinned)
    if (action === 'executeContract') expect(result).toMatchObject({ transactionId: 'at1wallet', outputs: ['record1output'] })
    else expect(result).toBe('at1wallet')
    expect(await store.list(scope)).toMatchObject([{ records: ['1group'],
      status: action === 'executeContract' ? 'confirmed' : 'submitted', transactionId: 'at1wallet' }])
    expect(await reservedRecordIds(client)).toEqual(new Set(['1group']))
    await expect(client[action](pinned)).rejects.toThrow('already reserved')
  })

  it('keeps the configured journal when adding compatibility or protocol decorators', async () => {
    const store = memoryRecordInventoryStore()
    const unusedStore = memoryRecordInventoryStore()
    const base = createWalletClient({ account, transport: transport(), recordManagement: { enabled: true, store, chainId: 'aleo:testnet' } })
    const client = base.extend(recordActions({ store: unusedStore })).extend((inner) => ({ spend: () => inner.writeContract(pinned) }))
    await expect(client.spend()).resolves.toBe('at1wallet')
    expect(await store.list(scope)).toHaveLength(1)
    expect(await unusedStore.list(scope)).toEqual([])
    expect(client.writeContract).toBe(base.writeContract)
  })

  it('enforces managed private-fee and uid restrictions only after explicit opt-in', async () => {
    const client = createWalletClient({ account, transport: transport(), recordManagement: { enabled: true } })
    await expect(client.writeContract({ ...pinned, privateFee: true })).rejects.toThrow('wallet protocol cannot pin')
    await expect(client.writeContract({ ...pinned, inputs: [{ type: 'record', program: asset.program, recordname: 'credits' }] })).rejects.toThrow('pinned record uid')
  })

  it('rejects a network switch on the original managed action closures', async () => {
    const rpc = transport()
    const client = createWalletClient({ account, transport: rpc, recordManagement: { enabled: true, chainId: 'aleo:testnet' } })
    rpc.config.network = undefined
    await expect(client.writeContract(pinned)).rejects.toThrow('network changed')
  })
})
