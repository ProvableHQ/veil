import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createWalletClient, recordActions, memoryRecordInventoryStore, parseRecord, type OwnedRecord, type RecordAsset, type TokenJoinRouter } from '../../src/index.js'
import { buildInventoryPlan } from '../../src/inventory/planner.js'

const credits: RecordAsset = { program: 'credits.aleo', standard: 'credits' }
const arc20: RecordAsset = { program: 'test_arc20_eth.aleo', standard: 'arc20' }
const arc22: RecordAsset = { program: 'test_usdcx_stablecoin.aleo', standard: 'arc22' }
const source = (asset: RecordAsset) => readFileSync(new URL(`../fixtures/programs/${asset.program}`, import.meta.url), 'utf8')
const scope = JSON.stringify(['testnet', 'aleo1owner'])
const router: TokenJoinRouter = { program: 'test_aj_arc20_2_15.aleo' }
const routerSource = readFileSync(new URL('../fixtures/programs/main_aj_arc20_2_15.aleo', import.meta.url), 'utf8')
  .replace('main_aj_arc20_2_15.aleo', router.program)
const makeRecord = (amount: bigint, nonce: number, asset = credits, extra = ''): OwnedRecord => ({
  programName: asset.program, recordName: asset.standard === 'credits' ? 'credits' : 'Token',
  tag: `${nonce}field`, commitment: `${nonce}field`, spent: false,
  recordPlaintext: `{ owner: aleo1owner.private, ${asset.standard === 'credits' ? 'microcredits' : 'amount'}: ${amount}${asset.standard === 'credits' ? 'u64' : 'u128'}.private, ${extra}_nonce: ${nonce}group.public }`,
})

function world(amounts: bigint[], asset = credits, tokenJoin?: TokenJoinRouter) {
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
    if (method === 'getProgram') return params.programId === tokenJoin?.program ? routerSource : source(asset)
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
    const amounts = params.functionName.startsWith('join') ? [inputs.reduce((sum: bigint, record: any) => sum + value(record), 0n)] :
      [BigInt(params.inputs[1].replace(/u(64|128)$/, '')), value(inputs[0]) - BigInt(params.inputs[1].replace(/u(64|128)$/, '')) - (asset.standard === 'credits' ? 10_000n : 0n)]
    const outputs = amounts.map((amount) => makeRecord(amount, next++, asset))
    const transaction = { id: `at1tx${++sequence}`, type: 'execute',
      fee: { transition: { inputs: [{ value: '100u64' }, { value: '0u64' }] } },
      execution: { transitions: params.functionName.startsWith('join_') ? [
        { id: 'au1intermediate', program: asset.program, function: 'join', outputs: [
          { id: 'intermediatefield', type: 'record_with_dynamic_id', dynamic_id: 'intermediatedynamicfield' }] },
        { id: `au1nested${sequence}`, program: asset.program, function: 'join', outputs: outputs.map((record) =>
          ({ id: record.commitment, type: 'record_with_dynamic_id', dynamic_id: `dynamic${sequence}field`, value: 'record1ciphertext' })) },
        { id: `au1outer${sequence}`, program: params.programName, function: params.functionName,
          outputs: [{ id: `dynamic${sequence}field`, type: 'record_dynamic' }] },
      ] : [{ id: `au1${sequence}`, program: asset.program, function: params.functionName,
        outputs: outputs.map((record) => ({ id: record.commitment, type: 'record', value: 'record1ciphertext' })) }] },
      testInputs: inputs.map((record: any) => record.nonce), testOutputs: outputs }
    return transaction as any
  })
  const account = { type: 'local' as const, address: 'aleo1owner', source: 'test', privateKey: 'test', viewKey: 'test', sign: vi.fn(), signMessage: vi.fn() }
  const transport = { config: { type: 'custom', key: 'test', name: 'Test', network: 'testnet' as const, request: send }, request: send }
  const client = createWalletClient({ account, transport, proving: { mode: 'local', buildTransaction: build },
    recordProvider: { requestRecords: scan, setAccount() {} } }).extend(recordActions({ store, tokenJoin }))
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

describe('configured token batch joins', () => {
  it('pins underlying wallet records and forwards the public identifier and dynamic import', async () => {
    const w = world([], arc22, router)
    const records = [1, 2, 3].map((nonce) => ({ programName: arc22.program, recordName: 'Token', uid: `wallet-${nonce}`,
      recordView: { fields: { $nonce: `${nonce}group`, amount: '100u128' } } }))
    const request = vi.fn(async ({ method, params }: any) => {
      if (method === 'getProgram') return params.programId === router.program ? routerSource : source(arc22)
      if (method === 'requestRecords') return records
      if (method === 'executeTransaction') return 'at1walletbatch'
      throw new Error(method)
    })
    const wallet = createWalletClient({ account: { ...w.client.account!, type: 'rpc' } as any,
      transport: { ...w.client.transport, request } as any }).extend(recordActions({ store: w.store, tokenJoin: router }))
    await wallet.joinRecords({ asset: arc22, records: (await wallet.getRecordInventory({ asset: arc22 })).available })
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'executeTransaction', params: expect.objectContaining({
      programName: router.program, functionName: 'join_3', imports: [arc22.program],
      inputs: ["'test_usdcx_stablecoin'", ...records.map((record) => ({ type: 'record', program: arc22.program, recordname: 'Token', uid: record.uid }))],
    }) }))
    expect((await w.store.list(scope))[0]).toMatchObject({ records: ['1group', '2group', '3group'],
      assetProgram: arc22.program, status: 'submitted', transactionId: 'at1walletbatch' })
  })
  it.each([2, 15, 16, 30])('consolidates %i records in bounded router transactions', async (count) => {
    const w = world(Array.from({ length: count }, () => 100n), arc20, router)
    const plan = await w.client.planRecordInventory({ asset: arc20, target: { records: 1 }, maxTransactions: 3 })
    expect(plan.tokenJoin).toEqual(router)
    expect(plan.steps).toHaveLength(Math.ceil((count - 1) / 14))
    expect(plan.steps.every((step) => step.inputs.length >= 2 && step.inputs.length <= 15)).toBe(true)
    const result = await w.client.rebalanceRecordInventory({ plan })
    expect(result).toMatchObject({ status: 'complete', completedSteps: plan.steps.length })
    const firstCount = Math.min(count, 15)
    const selected = plan.steps[0]!.inputs.map((id) => w.records.find((record) => parseRecord(record.recordPlaintext).nonce === id)!)
    expect(w.build.mock.calls[0]![0]).toMatchObject({ programName: router.program, functionName: `join_${firstCount}`,
      imports: [arc20.program], inputs: ["'test_arc20_eth'", ...selected.map((record) => record.recordPlaintext)] })
    expect((await w.client.getRecordInventory({ asset: arc20 })).balance).toBe(BigInt(count) * 100n)
    expect((await w.store.list(scope))[0]).toMatchObject({ program: router.program, assetProgram: arc20.program,
      function: `join_${firstCount}`, status: 'confirmed', records: plan.steps[0]!.inputs })
  })
  it.each([arc20, arc22])('preserves $standard target lots and executes batch joins followed by native splits', async (asset) => {
    const w = world(Array.from({ length: 16 }, () => 100n), asset, router)
    const preserve = await w.client.planRecordInventory({ asset, target: { records: 4 } })
    expect(preserve.steps).toHaveLength(1)
    expect(preserve.steps[0]?.inputs).toHaveLength(13)
    const plan = await w.client.planRecordInventory({ asset, target: { records: 4, distribution: 'balanced' } })
    expect(plan.steps.map((step) => step.kind)).toEqual(['join', 'join', 'split', 'split', 'split'])
    expect(await w.client.rebalanceRecordInventory({ plan })).toMatchObject({ status: 'complete', completedSteps: 5 })
    expect((await w.client.getRecordInventory({ asset })).available.map((record) => record.amount)).toEqual([400n, 400n, 400n, 400n])
    expect((await w.client.planRecordInventory({ asset, target: plan.target })).steps).toEqual([])
  })
  it('retains sufficient-record selection and native credits joins', async () => {
    const w = world([40n, 30n, 20n, 10n], arc20, router)
    expect(await w.client.autoJoin({ asset: arc20, minAmount: 80n })).toMatchObject({ status: 'complete', completedSteps: 1 })
    expect(w.build.mock.calls[0]![0].functionName).toBe('join_3')
    expect((await w.client.getRecordInventory({ asset: arc20 })).available.map((record) => record.amount)).toEqual([10n, 90n])
    const native = world([100n, 100n, 100n], credits, router)
    const plan = await native.client.planRecordInventory({ asset: credits, target: { records: 1 } })
    expect(plan.tokenJoin).toBeUndefined()
    expect(plan.steps.map((step) => step.inputs.length)).toEqual([2, 2])
    expect(await native.client.rebalanceRecordInventory({ plan })).toMatchObject({ status: 'complete' })
    expect(native.build.mock.calls.every(([params]) => params.programName === credits.program && params.functionName === 'join')).toBe(true)
  })
  it('keeps batch reservations atomic and enforces the proved fee limit', async () => {
    const w = world([100n, 100n, 100n], arc20, router)
    const records = (await w.client.getRecordInventory({ asset: arc20 })).available
    const results = await Promise.allSettled([w.client.joinRecords({ asset: arc20, records }), w.client.joinRecords({ asset: arc20, records: records.slice(0, 2) })])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(w.build).toHaveBeenCalledTimes(1)
    const limited = world([100n, 100n, 100n], arc20, router)
    const plan = await limited.client.planRecordInventory({ asset: arc20, target: { records: 1 } })
    expect(await limited.client.rebalanceRecordInventory({ plan, maxFeeMicrocredits: 99n })).toMatchObject({ status: 'interrupted', reason: expect.stringContaining('maxFeeMicrocredits') })
    expect(limited.send.mock.calls.some(([request]) => request.method === 'sendTransaction')).toBe(false)
    expect((await limited.store.list(scope))[0]).toMatchObject({ status: 'cancelled', records: ['1group', '2group', '3group'] })
  })
  it('rebroadcasts an interrupted batch proof and replans dependent inventory', async () => {
    const w = world(Array.from({ length: 16 }, () => 100n), arc22, router)
    const original = w.send.getMockImplementation()!
    w.send.mockImplementation(async (request) => { if (request.method === 'sendTransaction') throw new Error('offline'); return original(request) })
    const plan = await w.client.planRecordInventory({ asset: arc22, target: { records: 1 } })
    expect(await w.client.rebalanceRecordInventory({ plan })).toMatchObject({ status: 'interrupted', completedSteps: 0 })
    const saved = (await w.store.list(scope))[0]!
    expect(saved.records).toHaveLength(15)
    w.send.mockImplementation(original)
    await w.client.reconcileRecordInventory({ rebroadcast: true })
    expect(w.send).toHaveBeenLastCalledWith({ method: 'sendTransaction', params: { transaction: JSON.stringify(saved.transaction) } })
    await w.client.reconcileRecordInventory()
    expect(await w.client.autoJoin({ asset: arc22 })).toMatchObject({ status: 'complete', completedSteps: 1 })
    expect(w.build).toHaveBeenCalledTimes(2)
    expect((await w.client.getRecordInventory({ asset: arc22 })).balance).toBe(1600n)
  })
  it('rejects incompatible router code, duplicate inputs, overflow and excessive batch sizes before proving', async () => {
    const w = world(Array.from({ length: 16 }, () => 100n), arc20, router)
    const records = (await w.client.getRecordInventory({ asset: arc20 })).available
    await expect(w.client.joinRecords({ asset: arc20, records })).rejects.toThrow('2 to 15')
    await expect(w.client.joinRecords({ asset: arc20, records: [records[0]!, records[0]!] })).rejects.toThrow('distinct')
    const huge = world([(1n << 128n) - 1n, 1n], arc20, router)
    await expect(huge.client.joinRecords({ asset: arc20, records: (await huge.client.getRecordInventory({ asset: arc20 })).available })).rejects.toThrow('overflows')
    const original = w.send.getMockImplementation()!
    w.send.mockImplementation(async (request) => request.method === 'getProgram' && request.params.programId === router.program
      ? routerSource.replace('identifier.public', 'identifier.private') : original(request))
    await expect(w.client.joinRecords({ asset: arc20, records: records.slice(0, 2) })).rejects.toThrow('incompatible')
    expect(w.build).not.toHaveBeenCalled()
    expect(huge.build).not.toHaveBeenCalled()
  })
  it('rejects an unrelated or mismatched dynamic output instead of selecting intermediate records', async () => {
    const w = world([100n, 100n, 100n], arc20, router)
    const original = w.send.getMockImplementation()!
    w.send.mockImplementation(async (request) => {
      const result = await original(request)
      if (request.method === 'getConfirmedTransaction') result.transaction.execution.transitions.at(-1).outputs[0].id = 'unrelatedfield'
      return result
    })
    const plan = await w.client.planRecordInventory({ asset: arc20, target: { records: 1 } })
    expect(await w.client.rebalanceRecordInventory({ plan })).toMatchObject({ status: 'interrupted', reason: expect.stringContaining('underlying token commitment') })
    expect((await w.store.list(scope))[0]?.status).toBe('confirmed')
    expect(w.build).toHaveBeenCalledTimes(1)
  })
  it('honors custom batch ceilings and retains native plans created without a router', async () => {
    const w = world([100n, 100n, 100n, 100n], arc20, { ...router, maxRecords: 3 })
    const plan = await w.client.planRecordInventory({ asset: arc20, target: { records: 1 } })
    expect(plan.steps.map((step) => step.inputs.length)).toEqual([3, 2])
    expect(() => recordActions({ tokenJoin: { ...router, maxRecords: 16 } })(w.client)).toThrow('2 to 15')
    const native = buildInventoryPlan({ scope, asset: arc20, inputs: plan.inputs, target: plan.target })
    expect(await w.client.rebalanceRecordInventory({ plan: native })).toMatchObject({ status: 'complete', completedSteps: 3 })
    expect(w.build.mock.calls.every(([params]) => params.programName === arc20.program)).toBe(true)
  })
})
