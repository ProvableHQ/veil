import { describe, expect, it, vi } from 'vitest'
import { createWalletClient, memoryRecordInventoryStore, reservedRecordIds, TransportError } from '../../src/index.js'

const scope = JSON.stringify(['testnet', 'aleo1owner'])

function fixture() {
  const store = memoryRecordInventoryStore()
  const confirmations = new Map<string, 'accepted' | 'rejected'>()
  const broadcast = vi.fn(async (transaction: string) => JSON.parse(transaction).id as string)
  const request = vi.fn(async ({ method, params }: any) => {
    if (method === 'sendTransaction') return broadcast(params.transaction)
    if (method === 'getConfirmedTransaction') {
      const status = confirmations.get(params.id)
      if (status) return { status, transaction: { id: params.id } }
      throw new TransportError('Transaction not found', { status: 404 })
    }
    throw new Error('Unexpected request: ' + method)
  })
  const client = createWalletClient({
    account: { type: 'local', address: 'aleo1owner', privateKey: 'test', viewKey: 'test' } as any,
    transport: { config: { type: 'custom', key: 'test', name: 'Test', network: 'testnet', request }, request },
    recordManagement: { enabled: true, store },
  })
  const save = async (index: number, feeRecordId?: string) => {
    const transactionId = 'at1saved' + index
    return (await store.acquire({ scope, program: 'token.aleo', function: 'join',
      records: [index + 'group', ...(feeRecordId ? [feeRecordId] : [])], feeRecordId,
      status: 'prepared', accountType: 'local', createdAt: Date.now(), transactionId,
      transaction: { id: transactionId, type: 'execute' } as any }))!
  }
  return { client, store, confirmations, broadcast, request, save }
}

describe('inventory rebroadcast diagnostics', () => {
  it.each([new TransportError('Serial number already spent'), new Error('Network unavailable'), 'Broadcast denied'])(
    'retains failed spends and reconciles later entries after %s', async error => {
      const f = fixture()
      const failed = await f.save(1, 'fee1group')
      const confirmed = await f.save(2)
      f.confirmations.set(confirmed.transactionId!, 'accepted')
      f.broadcast.mockRejectedValue(error)
      for (const attempts of [1, 2]) {
        const journal = await f.client.reconcileRecordInventory({ rebroadcast: true })
        expect(journal[0]).toMatchObject({ status: 'prepared', transactionId: failed.transactionId,
          transaction: failed.transaction, records: failed.records, feeRecordId: 'fee1group',
          rebroadcastAttempts: attempts, lastRebroadcastError: error instanceof Error ? error.message : error })
        expect(journal[1]).toMatchObject({ status: 'confirmed' })
        expect(journal[1]!.transaction).toBeUndefined()
        expect(await reservedRecordIds(f.client)).toEqual(new Set([...failed.records, ...confirmed.records]))
      }
      expect(f.broadcast.mock.calls.map(([transaction]) => JSON.parse(transaction))).toEqual([failed.transaction, failed.transaction])
    },
  )

  it('clears the last error when the same saved transaction broadcasts successfully', async () => {
    const f = fixture()
    const saved = await f.save(1)
    f.broadcast.mockRejectedValueOnce(new Error('Network unavailable'))
    await f.client.reconcileRecordInventory({ rebroadcast: true })
    const journal = await f.client.reconcileRecordInventory({ rebroadcast: true })
    expect(journal[0]).toMatchObject({ status: 'submitted', rebroadcastAttempts: 2, transaction: saved.transaction })
    expect(journal[0]!.lastRebroadcastError).toBeUndefined()
    expect(f.broadcast.mock.calls.map(([transaction]) => JSON.parse(transaction))).toEqual([saved.transaction, saved.transaction])
  })

  it.each(['accepted', 'rejected'] as const)('clears stale errors after confirmed %s without rebroadcasting', async status => {
    const f = fixture()
    const saved = await f.save(1, 'fee1group')
    f.broadcast.mockRejectedValueOnce(new Error('Network unavailable'))
    await f.client.reconcileRecordInventory({ rebroadcast: true })
    f.confirmations.set(saved.transactionId!, status)
    const [entry] = await f.client.reconcileRecordInventory({ rebroadcast: true })
    expect(entry).toMatchObject({ status: status === 'accepted' ? 'confirmed' : 'rejected', rebroadcastAttempts: 1 })
    expect(entry!.transaction).toBeUndefined()
    expect(entry!.lastRebroadcastError).toBeUndefined()
    expect(f.broadcast).toHaveBeenCalledTimes(1)
    expect(await reservedRecordIds(f.client)).toEqual(new Set(status === 'accepted' ? saved.records : ['fee1group']))
  })

  it('records a mismatched broadcast id without overwriting the original proof or unlocking inputs', async () => {
    const f = fixture()
    const saved = await f.save(1)
    const later = await f.save(2)
    f.confirmations.set(later.transactionId!, 'accepted')
    f.broadcast.mockResolvedValue('at1different')
    const journal = await f.client.reconcileRecordInventory({ rebroadcast: true })
    expect(journal[0]).toMatchObject({ status: 'prepared', transactionId: saved.transactionId, transaction: saved.transaction,
      rebroadcastAttempts: 1, lastRebroadcastError: 'Rebroadcast returned a different transaction id' })
    expect(journal[1]!.status).toBe('confirmed')
    expect(await reservedRecordIds(f.client)).toContain(saved.records[0])
  })

  it('propagates a confirmation checkpoint storage 404 without rebroadcasting', async () => {
    const f = fixture()
    const saved = await f.save(1)
    f.confirmations.set(saved.transactionId!, 'accepted')
    vi.spyOn(f.store, 'update').mockRejectedValue(new TransportError('Journal entry missing', { status: 404 }))
    await expect(f.client.reconcileRecordInventory({ rebroadcast: true })).rejects.toThrow('Journal entry missing')
    expect(f.broadcast).not.toHaveBeenCalled()
  })

  it.each([true, false])('propagates storage errors when broadcast fails: %s', async fails => {
    const f = fixture()
    await f.save(1)
    if (fails) f.broadcast.mockRejectedValue(new Error('Network unavailable'))
    const update = vi.spyOn(f.store, 'update').mockRejectedValue(new Error('Journal unavailable'))
    await expect(f.client.reconcileRecordInventory({ rebroadcast: true })).rejects.toThrow('Journal unavailable')
    expect(update).toHaveBeenCalledTimes(1)
  })
})
