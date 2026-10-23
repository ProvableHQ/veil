import { describe, expect, it, vi } from 'vitest'
import { createWalletClient, memoryRecordInventoryStore, parseRecord, reservedRecordIds, type OwnedRecord } from '../../src/index.js'
import { transactionFee } from '../../src/inventory/spending.js'

const scope = JSON.stringify(['testnet', 'aleo1owner'])
const record = (nonce: number, amount: bigint): OwnedRecord => ({
  programName: 'credits.aleo', recordName: 'credits', tag: `${nonce}field`, spent: false,
  recordPlaintext: `{ owner: aleo1owner.private, microcredits: ${amount}u64.private, _nonce: ${nonce}group.public }`,
})
function world(records = [record(1, 500n), record(2, 110n), record(3, 200n)]) {
  const store = memoryRecordInventoryStore()
  let sequence = 0
  let accepted: 'accepted' | 'rejected' = 'accepted'
  let failure = false
  let wrongFee = false
  const prove = async (options: any) => {
    if (failure) throw new Error('Proving failed')
    const parsed = parseRecord(options.feeRecord)
    const selected = records.find(r => parseRecord(r.recordPlaintext).nonce === parsed.nonce)!
    return { id: `at1${++sequence}`, type: 'execute', execution: { transitions: [] }, fee: { transition: {
      program: 'credits.aleo', function: 'fee_private', inputs: [
        { type: 'record', tag: wrongFee ? '999field' : selected.tag }, { type: 'public', value: '100u64' },
        { type: 'public', value: `${options.fee ?? 0n}u64` },
      ],
    } } }
  }
  const send = vi.fn(async ({ method, params }: any) => {
    if (method === 'sendTransaction') return JSON.parse(params.transaction).id
    if (method === 'getConfirmedTransaction') return { status: accepted, transaction: { id: params.id } }
    throw new Error(method)
  })
  const build = vi.fn(prove)
  const execute = vi.fn(async (options: any) => {
    const tx = await prove(options)
    await options.onProgress({ type: 'transaction-prepared', transactionId: tx.id, transaction: tx })
    await send({ method: 'sendTransaction', params: { transaction: JSON.stringify(tx) } })
    await options.onProgress({ type: 'transaction-submitted', transactionId: tx.id })
    return { transactionId: tx.id, transitions: [], outputs: [] }
  })
  const client = createWalletClient({
    account: { type: 'local', source: 'fixture', address: 'aleo1owner', privateKey: 'fixture', viewKey: 'fixture', sign: vi.fn(), signMessage: vi.fn() },
    transport: { config: { type: 'custom', key: 'test', name: 'test', network: 'testnet', request: send }, request: send },
    proving: { mode: 'local', estimateExecutionFee: async () => 100n, buildTransaction: build, execute } as any,
    recordProvider: { requestRecords: async () => records, setAccount() {} },
    recordManagement: { enabled: true, store, maxFeeMicrocredits: 150n },
  })
  const params = { program: 'credits.aleo', function: 'transfer_private', inputs: [records[0]!.recordPlaintext, 'aleo1recipient', '1u64'], privateFee: true }
  return { client, store, params, build, send, records, reject: () => { accepted = 'rejected' }, fail: () => { failure = true }, wrongFee: () => { wrongFee = true } }
}

describe('managed private fees', () => {
  it.each(['writeContract', 'executeContract'] as const)('%s selects and journals a separate fee record including priority fees', async action => {
    const w = world()
    await w.client[action]({ ...w.params, ...(action === 'executeContract' ? { fee: 20n } : {}) })
    const [entry] = await w.store.list(scope)
    expect(entry).toMatchObject({ records: ['1group', action === 'executeContract' ? '3group' : '2group'],
      feeRecordId: action === 'executeContract' ? '3group' : '2group', feeMicrocredits: action === 'executeContract' ? '120' : '100', status: 'submitted' })
    expect(JSON.stringify(entry)).not.toContain('microcredits:')
  })
  it.each(['writeContract', 'executeContract'] as const)('%s reports input contention separately from private-fee exhaustion', async action => {
    const w = world()
    await w.store.acquire({ scope, records: ['1group'], program: 'credits.aleo', function: 'join', status: 'prepared', createdAt: 1, accountType: 'local' })
    await expect(w.client[action](w.params)).rejects.toMatchObject({ name: 'RecordReservationConflictError', recordIds: ['1group'] })
    expect(w.build).not.toHaveBeenCalled()
    expect(await w.store.list(scope)).toHaveLength(1)
  })
  it('does not classify unavailable private fees as an input reservation conflict', async () => {
    const w = world([record(1, 500n)])
    const error = await w.client.executeContract(w.params).catch(error => error)
    expect(error.message).toContain('private fee')
    expect(error.name).not.toBe('RecordReservationConflictError')
    expect(await w.store.list(scope)).toHaveLength(0)
  })
  it('uses a supplied fee record when it is eligible even if another is smaller', async () => {
    const w = world()
    await w.client.writeContract({ ...w.params, feeRecord: w.records[2]!.recordPlaintext } as any)
    expect((await w.store.list(scope))[0]?.feeRecordId).toBe('3group')
  })
  it('replaces a supplied fee record that is already reserved', async () => {
    const w = world()
    await w.store.acquire({ scope, records: ['3group'], program: 'credits.aleo', function: 'join', status: 'prepared', createdAt: 1, accountType: 'local' })
    await w.client.writeContract({ ...w.params, feeRecord: w.records[2]!.recordPlaintext } as any)
    expect((await w.store.list(scope))[1]?.feeRecordId).toBe('2group')
  })
  it('does not reuse a supplied fee record that is an execution input', async () => {
    const w = world()
    await w.client.writeContract({ ...w.params, feeRecord: w.records[0]!.recordPlaintext } as any)
    expect((await w.store.list(scope))[0]?.feeRecordId).toBe('2group')
  })
  it('chooses disjoint fee records when independent writes race', async () => {
    const w = world([record(1, 100n), record(2, 100n)])
    await Promise.all([1, 2].map(() => w.client.writeContract({ ...w.params, inputs: ['aleo1recipient', '1u64'] })))
    const entries = await w.store.list(scope)
    expect(new Set(entries.map(e => e.feeRecordId))).toEqual(new Set(['1group', '2group']))
  })
  it('excludes reserved records and fails before proving if no separate record covers the fee', async () => {
    const w = world([record(1, 500n), record(2, 100n), record(3, 99n)])
    await w.store.acquire({ scope, records: ['2group'], program: 'credits.aleo', function: 'join', status: 'prepared', createdAt: 1, accountType: 'local' })
    await expect(w.client.writeContract(w.params)).rejects.toThrow('private fee')
    expect(w.build).not.toHaveBeenCalled()
    expect(await w.store.list(scope)).toHaveLength(1)
  })
  it('releases both inputs when proving fails before a prepared transaction exists', async () => {
    const w = world(); w.fail()
    await expect(w.client.writeContract(w.params)).rejects.toThrow('Proving failed')
    expect((await w.store.list(scope))[0]).toMatchObject({ records: ['1group', '2group'], status: 'cancelled' })
    expect(await reservedRecordIds(w.client)).toEqual(new Set())
  })
  it('rejects a prover that spends a different fee record before broadcast', async () => {
    const w = world(); w.wrongFee()
    await expect(w.client.writeContract(w.params)).rejects.toThrow('reserved private fee record')
    expect(w.send).not.toHaveBeenCalled()
    expect((await w.store.list(scope))[0]?.status).toBe('cancelled')
  })
  it('retains the spent private fee after a rejected execution while releasing its other inputs', async () => {
    const w = world()
    await w.client.writeContract(w.params); w.reject()
    await w.client.reconcileRecordInventory()
    expect(await reservedRecordIds(w.client)).toEqual(new Set(['2group']))
    const entry = { scope, program: 'credits.aleo', function: 'join', status: 'reserved' as const, createdAt: 1, accountType: 'local' as const }
    expect(await w.store.acquire({ ...entry, records: ['2group'] })).toBeUndefined()
    expect(await w.store.acquire({ ...entry, records: ['1group'] })).toBeDefined()
  })
  it('preserves both reservations when broadcast outcome is unknown', async () => {
    const w = world()
    w.send.mockRejectedValue(new Error('Connection lost'))
    await expect(w.client.writeContract(w.params)).rejects.toThrow('Connection lost')
    expect((await w.store.list(scope))[0]).toMatchObject({ status: 'prepared', records: ['1group', '2group'] })
  })
  it('reads the public amounts after the record input in fee_private', () => {
    expect(transactionFee({ fee: { transition: { function: 'fee_private', inputs: [
      { type: 'record', tag: '1field' }, { value: '100u64' }, { value: '20u64' },
    ] } } } as any)).toBe(120n)
  })
})
