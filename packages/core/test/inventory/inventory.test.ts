import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createWalletClient, recordActions, memoryRecordInventoryStore, parseRecord, type OwnedRecord, type RecordAsset } from '../../src/index.js'
import { buildInventoryPlan } from '../../src/inventory/planner.js'

const credits: RecordAsset = { program: 'credits.aleo', standard: 'credits' }
const arc20: RecordAsset = { program: 'test_arc20_eth.aleo', standard: 'arc20' }
const arc22: RecordAsset = { program: 'test_usdcx_stablecoin.aleo', standard: 'arc22' }
const source = (asset: RecordAsset) => readFileSync(new URL(`../fixtures/programs/${asset.program}`, import.meta.url), 'utf8')
const scope = JSON.stringify(['testnet', 'aleo1owner'])
const makeRecord = (amount: bigint, nonce: number, asset = credits, extra = ''): OwnedRecord => ({
  programName: asset.program, recordName: asset.standard === 'credits' ? 'credits' : 'Token',
  tag: `${nonce}field`, commitment: `${nonce}field`, spent: false,
  recordPlaintext: `{ owner: aleo1owner.private, ${asset.standard === 'credits' ? 'microcredits' : 'amount'}: ${amount}${asset.standard === 'credits' ? 'u64' : 'u128'}.private, ${extra}_nonce: ${nonce}group.public }`,
})

function world(amounts: bigint[], asset = credits) {
  let records = amounts.map((amount, index) => makeRecord(amount, index + 1, asset))
  let next = 2000
  let sequence = 0
  const transactions = new Map<string, any>()
  const store = memoryRecordInventoryStore()
  const scan = vi.fn(async (params: any) => {
    let found = records.filter((record) => params.statusFilter !== 'unspent' || !record.spent)
    if (params.filter?.commitments) found = found.filter((record) => params.filter.commitments.includes(record.commitment))
    return found.slice((params.filter?.page ?? 0) * 1000, ((params.filter?.page ?? 0) + 1) * 1000)
  })
  const send = vi.fn(async ({ method, params }: any) => {
    if (method === 'getProgram') return source(asset)
    if (method === 'getConfirmedTransaction') {
      const transaction = transactions.get(params.id)
      if (!transaction) throw Object.assign(new Error('Not found'), { status: 404 })
      return { status: 'accepted', transaction }
    }
    if (method !== 'sendTransaction') throw new Error(method)
    const transaction = JSON.parse(params.transaction)
    const transition = transaction.execution.transitions[0]
    for (const id of transaction.testInputs) {
      const record = records.find((record) => parseRecord(record.recordPlaintext).nonce === id)
      if (record) record.spent = true
    }
    records.push(...transaction.testOutputs)
    transactions.set(transaction.id, transaction)
    return transaction.id
  })
  const build = vi.fn(async (params: any) => {
    const inputs = params.inputs.filter((input: string) => input.startsWith('{')).map((input: string) => parseRecord(input))
    const value = (record: any) => record.fields[asset.standard === 'credits' ? 'microcredits' : 'amount'].value as bigint
    const amounts = params.functionName === 'join' ? [value(inputs[0]) + value(inputs[1])] :
      [BigInt(params.inputs[1].replace(/u(64|128)$/, '')), value(inputs[0]) - BigInt(params.inputs[1].replace(/u(64|128)$/, '')) - (asset.standard === 'credits' ? 10_000n : 0n)]
    const outputs = amounts.map((amount) => makeRecord(amount, next++, asset))
    const transaction = { id: `at1tx${++sequence}`, type: 'execute',
      fee: { transition: { inputs: [{ value: '100u64' }, { value: '0u64' }] } },
      execution: { transitions: [{ id: `au1${sequence}`, program: asset.program, function: params.functionName,
        outputs: outputs.map((record) => ({ id: record.commitment, type: 'record', value: 'record1ciphertext' })) }] },
      testInputs: inputs.map((record: any) => record.nonce), testOutputs: outputs }
    return transaction as any
  })
  const account = { type: 'local' as const, address: 'aleo1owner', source: 'test', privateKey: 'test', viewKey: 'test', sign: vi.fn(), signMessage: vi.fn() }
  const transport = { config: { type: 'custom', key: 'test', name: 'Test', network: 'testnet' as const, request: send }, request: send }
  const client = createWalletClient({ account, transport, proving: { mode: 'local', buildTransaction: build },
    recordProvider: { requestRecords: scan, setAccount() {} } }).extend(recordActions({ store }))
  return { client, store, build, send, scan, transactions, records, setRecords: (value: OwnedRecord[]) => { records = value } }
}

describe('inventory planning', () => {
  const plan = (amounts: bigint[], count: number, asset = arc20, distribution: 'balanced' | 'preserve' = 'balanced') => buildInventoryPlan({
    scope, asset, target: { records: count, distribution }, inputs: amounts.map((amount, i) => ({ id: `${i}group`, amount })),
  })
  it('splits one ARC token record into exact balanced lots', () => {
    const result = plan([100n], 4)
    expect(result.steps).toHaveLength(3)
    expect(result.steps.map((step) => step.outputs[0]!.amount)).toEqual([25n, 25n, 25n])
    expect(result.deduction).toBe(0n)
  })
  it('accounts for every native credits split deduction', () => {
    const result = plan([1_030_000n], 4, credits)
    expect(result.deduction).toBe(30_000n)
    expect(result.steps.map((step) => step.amount)).toEqual([250_000n, 250_000n, 250_000n])
  })
  it('does nothing for already balanced inventory and tolerates atomic rounding', () => {
    expect(plan([25n, 25n, 25n, 25n], 4).steps).toEqual([])
    expect(plan([33n, 33n, 34n], 3).steps).toEqual([])
  })
  it('preserves existing records for count-only policies', () => {
    const result = plan([10n, 15n, 25n, 50n], 3, arc20, 'preserve')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.inputs).toEqual(['0group', '1group'])
  })
  it('preserves exact balanced lots and repacks when separate small records cannot split', () => {
    expect(plan([25n, 25n, 50n], 4).steps).toHaveLength(1)
    expect(plan([250_000n, 250_000n, 510_000n], 4, credits).steps).toHaveLength(1)
    const result = buildInventoryPlan({ scope, asset: arc20,
      inputs: [{ id: '1group', amount: 3n }, { id: '2group', amount: 3n }],
      target: { records: 3, minRecordAmount: 2n } })
    expect(result.steps.map((step) => step.kind)).toEqual(['join', 'split', 'split'])
    expect(result.steps.at(-1)!.outputs.map((record) => record.amount)).toEqual([2n, 2n])
  })
  it('rejects impossible counts, deductions, overflow, and operation limits', () => {
    expect(() => plan([10_001n], 2, credits)).toThrow('infeasible')
    expect(() => plan([10n], 0)).toThrow('records')
    expect(() => plan([(1n << 128n) - 1n, 1n], 1)).toThrow('overflow')
    expect(() => buildInventoryPlan({ scope, asset: arc20, inputs: [{ id: '1group', amount: 100n }], target: { records: 4 }, maxTransactions: 2 })).toThrow('maxTransactions')
  })
})

describe('scanner-backed inventory', () => {
  it('paginates beyond 1000 records and deduplicates identities', async () => {
    const w = world(Array.from({ length: 1001 }, () => 100n))
    const inventory = await w.client.getRecordInventory({ asset: credits })
    expect(inventory.available).toHaveLength(1001)
    expect(w.scan).toHaveBeenCalledTimes(2)
  })
  it.each([arc20, arc22])('filters compliance and recipient-bound records for $standard', async (asset) => {
    const w = world([10n], asset)
    w.records.push(makeRecord(20n, 2, asset, 'recipient_bound: true.private, '))
    w.records.push({ ...makeRecord(30n, 3, asset, 'sender: aleo1sender.private, recipient: aleo1owner.private, '), recordName: 'ComplianceRecord' })
    expect((await w.client.getRecordInventory({ asset })).balance).toBe(10n)
  })
  it('checks wallet grants before filtering and pins a granted uid when spending', async () => {
    const w = world([])
    let records: any[] = [{ programName: credits.program, tag: '1field', uid: 'wallet-record' }]
    const request = vi.fn(async ({ method }: any) => {
      if (method === 'requestRecords') return records
      if (method === 'executeTransaction') return 'at1wallet'
      throw new Error(method)
    })
    const client = createWalletClient({ account: { ...w.client.account!, type: 'rpc' } as any,
      transport: { ...w.client.transport, request } as any }).extend(recordActions({ store: w.store }))
    await expect(client.getRecordInventory({ asset: credits })).rejects.toThrow('recordName grant')
    records = [{ ...records[0], recordName: 'credits', recordView: { fields: { $nonce: '1group', microcredits: '1000000u64' } } }]
    const inventory = await client.getRecordInventory({ asset: credits })
    await client.splitRecord({ asset: credits, record: inventory.available[0]!, amount: 100_000n })
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'executeTransaction',
      params: expect.objectContaining({ inputs: [{ type: 'record', program: credits.program, recordname: 'credits', uid: 'wallet-record' }, '100000u64'] }) }))
    expect((await w.store.list(scope))[0]).toMatchObject({ records: ['1group'], status: 'submitted', transactionId: 'at1wallet' })
  })
  it('refuses missing wallet grants rather than claiming an empty inventory', async () => {
    const w = world([10n])
    w.setRecords([{ programName: credits.program, recordName: 'credits', tag: '1field' } as OwnedRecord])
    await expect(w.client.getRecordInventory({ asset: credits })).rejects.toThrow('grant')
  })
})

describe('inventory execution and recovery', () => {
  it.each([credits, arc20, arc22])('executes a dependent split plan for $standard and reaches an idempotent target', async (asset) => {
    const w = world([1_030_000n], asset)
    const target = { records: 4, distribution: 'balanced' as const }
    const plan = await w.client.planRecordInventory({ asset, target })
    const result = await w.client.rebalanceRecordInventory({ plan, pollIntervalMs: 1 })
    expect(result).toMatchObject({ status: 'complete', completedSteps: 3 })
    expect((await w.client.planRecordInventory({ asset, target })).steps).toEqual([])
    expect((await w.store.list(scope)).every((entry) => entry.status === 'confirmed')).toBe(true)
  })
  it('autojoins only enough records, retaining other inventory', async () => {
    const w = world([40n, 30n, 10n], arc20)
    const result = await w.client.autoJoin({ asset: arc20, minAmount: 60n })
    expect(result.completedSteps).toBe(1)
    expect((await w.client.getRecordInventory({ asset: arc20 })).available.map((record) => record.amount).sort()).toEqual([10n, 70n])
  })
  it('atomically rejects competing spending before the second proof', async () => {
    const w = world([1_000_000n])
    const record = (await w.client.getRecordInventory({ asset: credits })).available[0]!
    const results = await Promise.allSettled([w.client.splitRecord({ asset: credits, record, amount: 100_000n }), w.client.splitRecord({ asset: credits, record, amount: 200_000n })])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(w.build).toHaveBeenCalledTimes(1)
  })
  it('enforces fees before broadcast and releases a build rejected by its budget', async () => {
    const w = world([1_000_000n])
    const plan = await w.client.planRecordInventory({ asset: credits, target: { records: 2 } })
    const result = await w.client.rebalanceRecordInventory({ plan, maxFeeMicrocredits: 99n })
    expect(result.status).toBe('interrupted')
    expect(result.reason).toContain('maxFeeMicrocredits')
    expect(w.send.mock.calls.some(([request]) => request.method === 'sendTransaction')).toBe(false)
    expect((await w.store.list(scope))[0]?.status).toBe('cancelled')
  })
  it('retains a prepared transaction when the broadcast response is lost, then reconciles acceptance', async () => {
    const w = world([1_000_000n])
    const original = w.send.getMockImplementation()!
    w.send.mockImplementation(async (request) => { const result = await original(request); if (request.method === 'sendTransaction') throw new Error('response lost'); return result })
    const plan = await w.client.planRecordInventory({ asset: credits, target: { records: 2 } })
    const result = await w.client.rebalanceRecordInventory({ plan })
    expect(result).toMatchObject({ status: 'interrupted', transactionIds: ['at1tx1'] })
    expect((await w.store.list(scope))[0]).toMatchObject({ status: 'prepared', transactionId: 'at1tx1' })
    await w.client.reconcileRecordInventory()
    expect((await w.store.list(scope))[0]?.status).toBe('confirmed')
  })
  it('rebroadcasts the exact saved transaction without rebuilding its proof', async () => {
    const w = world([1_000_000n])
    const original = w.send.getMockImplementation()!
    w.send.mockImplementation(async (request) => {
      if (request.method === 'sendTransaction') throw new Error('offline before acceptance')
      return original(request)
    })
    const plan = await w.client.planRecordInventory({ asset: credits, target: { records: 2 } })
    await w.client.rebalanceRecordInventory({ plan })
    const saved = (await w.store.list(scope))[0]!
    await w.client.reconcileRecordInventory() // A 404 must retain the reservation.
    expect((await w.store.list(scope))[0]?.status).toBe('prepared')
    w.send.mockImplementation(original)
    await w.client.reconcileRecordInventory({ rebroadcast: true })
    expect(w.send).toHaveBeenLastCalledWith({ method: 'sendTransaction', params: { transaction: JSON.stringify(saved.transaction) } })
    expect(w.build).toHaveBeenCalledTimes(1)
    await w.client.reconcileRecordInventory()
    expect((await w.store.list(scope))[0]).toMatchObject({ status: 'confirmed' })
    expect((await w.store.list(scope))[0]?.transaction).toBeUndefined()
  })
  it('releases inputs only after a confirmed rejection', async () => {
    const w = world([1_000_000n])
    const original = w.send.getMockImplementation()!
    w.send.mockImplementation(async (request) => {
      if (request.method === 'getConfirmedTransaction') return { status: 'rejected' }
      if (request.method === 'sendTransaction') return JSON.parse(request.params.transaction).id
      return original(request)
    })
    const plan = await w.client.planRecordInventory({ asset: credits, target: { records: 2 } })
    expect((await w.client.rebalanceRecordInventory({ plan })).status).toBe('interrupted')
    expect((await w.store.list(scope))[0]?.status).toBe('rejected')
    expect((await w.client.getRecordInventory({ asset: credits })).available).toHaveLength(1)
  })
  it('does not confuse a new deposit with the expected scanner outputs', async () => {
    const w = world([1_000_000n])
    const plan = await w.client.planRecordInventory({ asset: credits, target: { records: 2 } })
    const original = w.scan.getMockImplementation()!
    w.scan.mockImplementation(async (params) => params.filter?.commitments ? [makeRecord(1_000_000n, 9999)] : original(params))
    const result = await w.client.rebalanceRecordInventory({ plan, timeoutMs: 15, pollIntervalMs: 1 })
    expect(result).toMatchObject({ status: 'interrupted', completedSteps: 0 })
    expect(result.reason).toContain('Scanner')
    expect(w.build).toHaveBeenCalledTimes(1)
  })
  it('retains uncertain inputs on a confirmation outage', async () => {
    const w = world([1_000_000n])
    const plan = await w.client.planRecordInventory({ asset: credits, target: { records: 2 } })
    const original = w.send.getMockImplementation()!
    w.send.mockImplementation(async (request) => { if (request.method === 'getConfirmedTransaction') throw new Error('network offline'); return original(request) })
    const result = await w.client.rebalanceRecordInventory({ plan })
    expect(result.status).toBe('interrupted')
    await expect(w.client.reconcileRecordInventory()).rejects.toThrow('network offline')
    expect((await w.store.list(scope))[0]?.status).toBe('submitted')
  })
  it('rejects stale inputs, modified plans, cancellation and private fees', async () => {
    const w = world([1_000_000n])
    const plan = await w.client.planRecordInventory({ asset: credits, target: { records: 2 } })
    const altered = { ...plan, steps: plan.steps.map((step) => ({ ...step, amount: 1n })) }
    await expect(w.client.rebalanceRecordInventory({ plan: altered })).rejects.toThrow('modified')
    const cancelled = await w.client.rebalanceRecordInventory({ plan, signal: AbortSignal.abort() })
    expect(cancelled.status).toBe('interrupted')
    w.setRecords([])
    expect((await w.client.rebalanceRecordInventory({ plan })).reason).toContain('changed')
    await expect(w.client.writeContract({ program: credits.program, function: 'join', inputs: [], privateFee: true })).rejects.toThrow('public fees')
    expect(w.build).not.toHaveBeenCalled()
  })
})
