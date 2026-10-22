import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createWalletClient, memoryRecordInventoryStore, type RecordAsset, type RecordManagementConfig } from '../../src/index.js'

// These ABI fixtures use the external-record signature of the deployed credits
// helpers and the dynamic signature of the checked-in ARC helper program.
function staticHelper(program: string, asset: string, record: string, min: number, max: number) {
  return `import ${asset};\nprogram ${program};\n` + Array.from({ length: max - min + 1 }, (_, i) => {
    const n = i + min
    return `function join_${n}:\n` + Array.from({ length: n }, (_, j) => `    input r${j} as ${asset}/${record}.record;\n`).join('') +
      `    output r${n} as ${asset}/${record}.record;\n`
  }).join('\n')
}
function world(program = 'credits.aleo', options: { network?: 'mainnet' | 'testnet' | null; helpers?: boolean; tokenJoin?: false; enabled?: boolean } = {}) {
  const isCredits = program === 'credits.aleo'
  const name = isCredits ? 'credits' : 'Token', field = isCredits ? 'microcredits' : 'amount', width = isCredits ? 'u64' : 'u128'
  const network = options.network === undefined ? 'testnet' : options.network
  let next = 100, records: any[] = []
  const sources = new Map<string, string>()
  if (!isCredits) sources.set(program, readFileSync(new URL(`../fixtures/programs/${program}`, import.meta.url), 'utf8'))
  if (options.helpers !== false) {
    const prefix = isCredits ? 'autojoin_credits' : `aj_${program.slice(0, -5)}`
    for (const [min, max] of [[2, 10], [11, 14], [15, 16]]) {
      const helper = `${prefix}_${min}_${max}.aleo`
      sources.set(helper, staticHelper(helper, program, name, min!, max!))
    }
    const dynamic = `${network === 'mainnet' ? 'main' : 'test'}_aj_arc20_2_15.aleo`
    sources.set(dynamic, readFileSync(new URL('../fixtures/programs/main_aj_arc20_2_15.aleo', import.meta.url), 'utf8')
      .replaceAll('main_aj_arc20_2_15.aleo', dynamic))
  }
  const makeRecord = (amount: bigint, n: number) => ({ programName: program, recordName: name, uid: `wallet-${n}`, commitment: `${n}field`, spent: false,
    recordView: { fields: { $nonce: `${n}group`, [field]: `${amount}${width}` } } })
  const transactions = new Map<string, any>()
  const calls: any[] = []
  const store = memoryRecordInventoryStore()
  const request = vi.fn(async ({ method, params }: any) => {
    if (method === 'getProgram') {
      if (sources.has(params.programId)) return sources.get(params.programId)
      throw Object.assign(new Error('Program not found'), { status: 404 })
    }
    if (method === 'requestRecords') return records.filter(record => !record.spent)
    if (method === 'getConfirmedTransaction') return { status: 'accepted', transaction: transactions.get(params.id) }
    if (method !== 'executeTransaction') throw new Error(method)
    calls.push(params)
    const selected = params.inputs.filter((input: any) => typeof input === 'object').map((input: any) => records.find(record => record.uid === input.uid)!)
    expect(selected.every((record: any) => record && !record.spent)).toBe(true)
    const sum = selected.reduce((total: bigint, record: any) => total + BigInt(record.recordView.fields[field].slice(0, -width.length)), 0n)
    const amounts = params.functionName === 'split'
      ? [BigInt(params.inputs[1].slice(0, -width.length)), sum - BigInt(params.inputs[1].slice(0, -width.length)) - (isCredits ? 10000n : 0n)] : [sum]
    const outputs = amounts.map(amount => makeRecord(amount, next++))
    selected.forEach((record: any) => { record.spent = true })
    records.push(...outputs)
    const dynamic = typeof params.inputs[0] === 'string'
    const transaction = { id: `at1tx${calls.length}`, type: 'execute', execution: { transitions: [
      ...(dynamic ? [{ id: 'au1inner', program, function: 'join', outputs: [{ type: 'record_with_dynamic_id', id: outputs[0]!.commitment, dynamic_id: 'dynamicfield' }] }] : []),
      { id: 'au1outer', program: params.programName, function: params.functionName,
        outputs: dynamic ? [{ type: 'record_dynamic', id: 'dynamicfield' }] : outputs.map(record => ({ type: 'record', id: record.commitment, value: 'record1ciphertext' })) },
    ] } }
    transactions.set(transaction.id, transaction)
    return transaction.id
  })
  const recordManagement: RecordManagementConfig = { enabled: options.enabled ?? true, store, tokenJoin: options.tokenJoin }
  const client = createWalletClient({ account: { type: 'rpc', address: 'aleo1owner', sign: vi.fn(), signMessage: vi.fn() },
    transport: { config: { type: 'custom', key: 'test', name: 'test', network, request }, request },
    recordManagement: { ...recordManagement, chainId: network ?? 'local:test' } })
  return { client, sources, calls, store, request, setAmounts: (amounts: bigint[]) => { records = amounts.map((amount, i) => makeRecord(amount, i + 1)) } }
}

describe('automatic join helper selection', () => {
  it.each([
    [3, 'autojoin_credits_2_10.aleo'], [11, 'autojoin_credits_11_14.aleo'],
    [15, 'autojoin_credits_15_16.aleo'], [16, 'autojoin_credits_15_16.aleo'],
  ])('uses one helper transaction for %i credits records', async (count, helper) => {
    const w = world(); w.setAmounts(Array.from({ length: count as number }, () => 100n))
    const plan = await w.client.planRecordInventory({ asset: { program: 'credits.aleo' }, target: { records: 1 }, maxTransactions: 1 })
    expect(plan.steps).toHaveLength(1)
    expect(await w.client.rebalanceRecordInventory({ plan })).toMatchObject({ status: 'complete', completedSteps: 1 })
    expect(w.calls[0]).toMatchObject({ programName: helper, functionName: `join_${count}` })
    expect(w.calls[0].inputs).toHaveLength(count as number)
    expect((await w.client.getRecordInventory({ asset: { program: 'credits.aleo' } })).balance).toBe(BigInt(count) * 100n)
    expect((await w.store.list(JSON.stringify(['testnet', 'aleo1owner'])))[0]).toMatchObject({ assetProgram: 'credits.aleo', status: 'confirmed' })
  })

  it('chains a 16-record helper output into a native join for 17 credits records', async () => {
    const w = world(); w.setAmounts(Array.from({ length: 17 }, () => 100n))
    expect(await w.client.autoJoin({ asset: { program: 'credits.aleo' }, maxTransactions: 2 })).toMatchObject({ status: 'complete', completedSteps: 2 })
    expect(w.calls.map(call => [call.programName, call.functionName])).toEqual([
      ['autojoin_credits_15_16.aleo', 'join_16'], ['credits.aleo', 'join'],
    ])
    expect(w.calls[1].inputs.some((input: any) => input.uid === 'wallet-100')).toBe(true)
  })

  it('prefers a dedicated stablecoin helper over a generic ARC helper', async () => {
    const w = world('test_usdcx_stablecoin.aleo'); w.setAmounts([10n, 20n, 30n])
    const asset: RecordAsset = { program: 'test_usdcx_stablecoin.aleo' }
    await w.client.joinRecords({ asset, records: (await w.client.getRecordInventory({ asset })).available })
    expect(w.calls[0]).toMatchObject({ programName: 'aj_test_usdcx_stablecoin_2_10.aleo', functionName: 'join_3' })
    expect(w.calls[0].inputs.every((input: any) => typeof input === 'object')).toBe(true)
  })

  it.each(['mainnet', 'testnet'] as const)('uses the %s dynamic ARC helper with a program identifier', async network => {
    const w = world('test_arc20_eth.aleo', { network }); w.setAmounts([10n, 20n, 30n])
    const asset = { program: 'test_arc20_eth.aleo' }
    expect(await w.client.autoJoin({ asset, maxTransactions: 1 })).toMatchObject({ status: 'complete', completedSteps: 1 })
    expect(w.calls[0]).toMatchObject({ programName: `${network === 'mainnet' ? 'main' : 'test'}_aj_arc20_2_15.aleo`, functionName: 'join_3',
      imports: [asset.program], inputs: ["'test_arc20_eth'", expect.any(Object), expect.any(Object), expect.any(Object)] })
  })

  it.each([{ helpers: false }, { tokenJoin: false as const }, { network: null }])('falls back to native joins for unavailable, disabled, or unknown-network helpers: %j', async options => {
    const w = world('credits.aleo', options); w.setAmounts([100n, 100n, 100n])
    expect(await w.client.autoJoin({ asset: { program: 'credits.aleo' } })).toMatchObject({ status: 'complete', completedSteps: 2 })
    expect(w.calls.map(call => call.programName)).toEqual(['credits.aleo', 'credits.aleo'])
  })

  it('rejects a mismatched external record ABI before choosing a helper', async () => {
    const w = world(); w.setAmounts([100n, 100n, 100n])
    w.sources.set('autojoin_credits_2_10.aleo', staticHelper('autojoin_credits_2_10.aleo', 'other.aleo', 'credits', 2, 10))
    const plan = await w.client.planRecordInventory({ asset: { program: 'credits.aleo' }, target: { records: 1 } })
    expect(plan.steps.map(step => step.inputs.length)).toEqual([2, 2])
  })

  it('surfaces helper lookup outages without submitting native transactions', async () => {
    const w = world(); w.setAmounts([100n, 100n, 100n])
    // Keep wallet inventory available while the public helper source lookup fails.
    const inventory = [1, 2, 3].map(n => ({ programName: 'credits.aleo', recordName: 'credits', uid: `wallet-${n}`,
      recordView: { fields: { $nonce: `${n}group`, microcredits: '100u64' } } }))
    w.request.mockImplementation(async ({ method }: any) => {
      if (method === 'requestRecords') return inventory
      throw Object.assign(new Error('Gateway unavailable'), { status: 503 })
    })
    await expect(w.client.autoJoin({ asset: { program: 'credits.aleo' } })).rejects.toThrow('Gateway unavailable')
    expect(w.calls).toHaveLength(0)
  })

  it('keeps the helper chosen during planning and rejects a changed helper ABI before submission', async () => {
    const w = world(); w.setAmounts([100n, 100n, 100n])
    const plan = await w.client.planRecordInventory({ asset: { program: 'credits.aleo' }, target: { records: 1 } })
    w.sources.set('autojoin_credits_2_10.aleo', staticHelper('autojoin_credits_2_10.aleo', 'other.aleo', 'credits', 2, 10))
    expect(await w.client.rebalanceRecordInventory({ plan })).toMatchObject({ status: 'interrupted', completedSteps: 0, reason: expect.stringContaining('incompatible') })
    expect(w.calls).toHaveLength(0)
  })

  it('uses helpers for an explicit join without enabling coordination', async () => {
    const w = world('credits.aleo', { enabled: false }); w.setAmounts([100n, 100n, 100n])
    const asset = { program: 'credits.aleo' }
    await w.client.joinRecords({ asset, records: (await w.client.getRecordInventory({ asset })).available })
    expect(w.calls[0].functionName).toBe('join_3')
    expect(await w.store.list(JSON.stringify(['testnet', 'aleo1owner']))).toEqual([])
  })
})
