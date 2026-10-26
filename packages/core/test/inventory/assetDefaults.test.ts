import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createWalletClient, type RecordAsset } from '../../src/index.js'

const programSource = (program: string, recordName: string, fields: string, amountType = 'u64') => `program ${program};
record ${recordName}:
    owner as address.private;
${fields}
function join:
    input r0 as ${recordName}.record;
    input r1 as ${recordName}.record;
    output r2 as ${recordName}.record;
function split:
    input r0 as ${recordName}.record;
    input r1 as ${amountType}.private;
    output r2 as ${recordName}.record;
    output r3 as ${recordName}.record;
`
function wallet(program: string, recordName: string, fields: Record<string, string>, source: string) {
  const records = [1, 2].map(n => ({ programName: program, recordName, uid: `wallet-${n}`, commitment: `${n}field`,
    recordView: { fields: { $nonce: `${n}group`, ...fields } } }))
  const request = vi.fn(async ({ method, params }: any) => {
    if (method === 'getProgram' && params.programId === program) return source
    if (method === 'getProgram') throw Object.assign(new Error('Program not found'), { status: 404 })
    if (method === 'requestRecords') return records
    if (method === 'executeTransaction') return 'at1submitted'
    throw new Error(method)
  })
  const client = createWalletClient({ account: { type: 'rpc', address: 'aleo1owner', sign: vi.fn(), signMessage: vi.fn() },
    transport: { config: { type: 'custom', key: 'test', name: 'test', network: 'testnet', request }, request } })
  return { client, request, records }
}

describe('record asset defaults and overrides', () => {
  it.each([
    { program: 'credits.aleo', record: 'credits', field: 'microcredits', width: 'u64' },
    { program: 'test_arc20_eth.aleo', record: 'Token', field: 'amount', width: 'u128' },
    { program: 'test_usdcx_stablecoin.aleo', record: 'Token', field: 'amount', width: 'u128' },
  ])('reads $program without a standard and pins the default record for joins', async ({ program, record, field, width }) => {
    const source = program === 'credits.aleo' ? programSource(program, record, `    ${field} as ${width}.private;`, width)
      : readFileSync(new URL(`../fixtures/programs/${program}`, import.meta.url), 'utf8')
    const { client, request } = wallet(program, record, { [field]: `50000${width}` }, source)
    const asset: RecordAsset = { program }
    const inventory = await client.getRecordInventory({ asset })
    expect(inventory.balance).toBe(100000n)
    await client.joinRecords({ asset, records: inventory.available })
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'executeTransaction', params: expect.objectContaining({
      programName: program, functionName: 'join', inputs: [1, 2].map(n => ({ type: 'record', program, recordname: record, uid: `wallet-${n}` })),
    }) }))
    expect(client.recordManagement).toBeUndefined()
  })

  it.each([
    { fields: '    amount as u64.private;\n    microcredits as u64.private;', grants: { amount: '7u64', microcredits: '99u64' }, want: 14n },
    { fields: '    microcredits as u64.private;', grants: { microcredits: '9u64' }, want: 18n },
  ])('prefers amount and falls back to microcredits in a custom record', async ({ fields, grants, want }) => {
    const { client } = wallet('custom.aleo', 'Balance', grants, programSource('custom.aleo', 'Balance', fields))
    expect((await client.getRecordInventory({ asset: { program: 'custom.aleo' } })).balance).toBe(want)
  })

  it('uses explicit record and field overrides for scans, wallet inputs, splits, and plans', async () => {
    const { client, request } = wallet('custom.aleo', 'Balance', { value: '100u64', amount: '999u64' },
      programSource('custom.aleo', 'Balance', '    value as u64.private;\n    amount as u64.private;'))
    const asset: RecordAsset = { program: 'custom.aleo', recordName: 'Balance', amountField: 'value' }
    const inventory = await client.getRecordInventory({ asset })
    expect(inventory.balance).toBe(200n)
    const plan = await client.planRecordInventory({ asset, target: { records: 4 } })
    expect(plan.asset).toMatchObject(asset)
    expect(plan.steps.map(step => step.amount)).toEqual([50n, 50n])
    await client.splitRecord({ asset, record: inventory.available[0]!, amount: 25n })
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'executeTransaction', params: expect.objectContaining({
      inputs: [{ type: 'record', program: 'custom.aleo', recordname: 'Balance', uid: 'wallet-1' }, '25u64'],
    }) }))
  })

  it('rejects a missing override instead of spending a different amount field', async () => {
    const { client, request } = wallet('custom.aleo', 'Balance', { amount: '100u64' },
      programSource('custom.aleo', 'Balance', '    amount as u64.private;'))
    await expect(client.getRecordInventory({ asset: { program: 'custom.aleo', amountField: 'missing' } })).rejects.toThrow('amount field')
    expect(request.mock.calls.some(([call]) => call.method === 'executeTransaction')).toBe(false)
  })

  it('does not fall back to a granted microcredits field when the selected amount grant is missing', async () => {
    const { client } = wallet('custom.aleo', 'Balance', { microcredits: '100u64' },
      programSource('custom.aleo', 'Balance', '    amount as u64.private;\n    microcredits as u64.private;'))
    await expect(client.getRecordInventory({ asset: { program: 'custom.aleo' } })).rejects.toThrow('amount grant')
  })

  it('enforces the deployed custom amount width before joining', async () => {
    const { client } = wallet('custom.aleo', 'Balance', { quantity: `${(1n << 64n) - 1n}u64` },
      programSource('custom.aleo', 'Balance', '    quantity as u64.private;'))
    const asset: RecordAsset = { program: 'custom.aleo', recordName: 'Balance', amountField: 'quantity' }
    const records = (await client.getRecordInventory({ asset })).available
    await expect(client.joinRecords({ asset, records })).rejects.toThrow('overflows')
  })

  it('selects the native join record even when an unrelated Token record exists', async () => {
    const source = programSource('custom.aleo', 'Balance', '    amount as u64.private;') +
      '\nrecord Token:\n    owner as address.private;\n    amount as u128.private;'
    const { client } = wallet('custom.aleo', 'Balance', { amount: '5u64' }, source)
    const inventory = await client.getRecordInventory({ asset: { program: 'custom.aleo' } })
    expect(inventory.asset.recordName).toBe('Balance')
    expect(inventory.balance).toBe(10n)
  })

  it.each(['token_id as field', 'sender as address', 'recipient as address'])('excludes opaque non-fungible/compliance records declaring %s', async declaration => {
    const { client } = wallet('custom.aleo', 'Balance', { amount: '5u64' },
      programSource('custom.aleo', 'Balance', `    amount as u64.private;\n    ${declaration}.private;`))
    expect((await client.getRecordInventory({ asset: { program: 'custom.aleo' } })).available).toEqual([])
  })

  it('uses the custom record name and u32 amount field with a local scanner and prover', async () => {
    const source = programSource('custom.aleo', 'Balance', '    quantity as u32.private;', 'u32')
    const record = { programName: 'custom.aleo', recordName: 'Balance', commitment: '1field',
      recordPlaintext: '{ owner: aleo1owner.private, quantity: 100u32.private, _nonce: 1group.public }' }
    const scan = vi.fn(async () => [record])
    const build = vi.fn(async () => ({ id: 'at1local', type: 'execute', execution: { transitions: [] } } as any))
    const request = vi.fn(async ({ method }: any) => method === 'getProgram' ? source : 'at1local')
    const client = createWalletClient({ account: { type: 'local', address: 'aleo1owner', source: 'test',
      privateKey: 'test', viewKey: 'test', sign: vi.fn(), signMessage: vi.fn() },
      transport: { config: { type: 'custom', key: 'test', name: 'test', network: 'testnet', request }, request },
      recordProvider: { requestRecords: scan, setAccount() {} }, proving: { mode: 'local', buildTransaction: build } })
    const asset = { program: 'custom.aleo', recordName: 'Balance', amountField: 'quantity' }
    const inventory = await client.getRecordInventory({ asset })
    expect(scan).toHaveBeenCalledWith(expect.objectContaining({ filter: expect.objectContaining({ records: ['Balance'] }) }))
    expect(inventory.balance).toBe(100n)
    await client.splitRecord({ asset, record: inventory.available[0]!, amount: 25n })
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ inputs: [record.recordPlaintext, '25u32'] }))
  })

})
