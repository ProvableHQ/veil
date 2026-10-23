import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { COMMANDS } from '../src/registry.js'
import { setJsonMode } from '../src/shared.js'
import { loadState } from '../src/session.js'

// Replace the external signer/scanner boundary; parsing, command dispatch,
// configuration, JSON output, and SQLite reservations remain real.
vi.mock('@provablehq/veil-aleo-sdk', () => ({ loadNetwork: vi.fn(), generateAccount: vi.fn() }))
vi.mock('../src/session.js', async original => ({ ...await original<object>(), loadState: vi.fn() }))
vi.mock('../src/inventory/runner.js', () => ({ runInventoryCycle: vi.fn() }))

let directory: string, database: string, stdout: string[], options: any[], executions: number
let previousExitCode: typeof process.exitCode
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shield-inventory-command-'))
  database = join(directory, 'inventory.sqlite')
  stdout = []; options = []; executions = 0
  previousExitCode = process.exitCode; process.exitCode = undefined
  vi.stubEnv('ALEO_PRIVATE_KEY', '')
  vi.stubEnv('SHIELD_SWAP_NETWORK', 'testnet')
  vi.stubEnv('VEIL_INVENTORY_DB', database)
  vi.mocked(loadState).mockImplementation(network => ({ network, privateKey: `state-key-${network}` }))
  vi.spyOn(console, 'log').mockImplementation(value => { stdout.push(String(value)) })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`EXIT:${code}`) })
  vi.mocked(loadNetwork).mockImplementation(async network => ({
    createRemoteScanner: () => ({}),
    createAleoClient: (config: any) => {
      options.push({ ...config, network })
      return { account: { address: 'aleo1fixture' }, walletClient: {
        getRecordInventory: async ({ asset }: any) => ({ asset, balance: 100n, reserved: [],
          available: [{ id: '1group', amount: 100n, record: { recordPlaintext: 'private-record-content' } }] }),
        planRecordInventory: async ({ asset, target }: any) => ({ asset, target, steps: [{ kind: 'split' }], inputs: [{ id: '1group', amount: 100n }] }),
      } }
    },
  }) as any)
})
afterEach(async () => {
  setJsonMode(false); process.exitCode = previousExitCode
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

async function inventory(argv: string[]) {
  setJsonMode(argv.includes('--json'))
  expect(COMMANDS.inventory, 'inventory must be reachable from shield-swap').toBeDefined()
  await (await COMMANDS.inventory!.load()).main(argv)
}
async function entries() {
  const { sqliteRecordInventoryStore } = await import('../src/storage.js')
  const store = await sqliteRecordInventoryStore(database)
  try { return await store.list(JSON.stringify(['aleo:testnet', 'aleo1fixture'])) }
  finally { store.close() }
}
async function execution(stopping = false) {
  const { runInventoryCycle } = await import('../src/inventory/runner.js')
  vi.mocked(runInventoryCycle).mockImplementation(async (_client, _config, store, scope) => {
    executions++
    expect((await store.list(scope)).some(entry => entry.program === '__inventory_manager__' && entry.status === 'reserved')).toBe(true)
    await store.acquire({ scope, records: ['spentgroup'], program: 'credits.aleo', function: 'split', status: 'confirmed', createdAt: Date.now(), accountType: 'local' })
    if (stopping) process.emit('SIGTERM')
    return [{ program: 'credits.aleo', status: 'complete', result: { status: 'complete', completedSteps: 1, transactionIds: ['at1confirmed'] } }]
  })
}

describe('shield-swap inventory command', () => {
  it('shows help without opening an account or journal', async () => {
    await expect(inventory(['--help'])).rejects.toThrow('EXIT:0')
    expect(stdout.join('\n')).toContain('inspect|plan|rebalance|run|status')
    expect(options).toEqual([])
  })
  it.each(['plan', 'rebalance', 'run'])('%s only plans without --execute', async command => {
    await inventory([command, '--asset', 'credits.aleo', '--records', '2', '--json'])
    const result = JSON.parse(stdout.join('\n'))
    expect(result.plans[0].target.records).toBe(2)
    expect(result.plans[0].inputs[0].amount).toBe('100')
    expect(result.network).toBe('testnet')
    expect(options[0].privateKey).toBe('state-key-testnet')
    expect(options[0].recordManagement).toMatchObject({ enabled: true, chainId: 'aleo:testnet' })
    expect(executions).toBe(0)
    expect(await entries()).toEqual([])
  })
  it('inspects multiple assets in one JSON object without exposing plaintext', async () => {
    const config = join(directory, 'policies.json')
    await writeFile(config, JSON.stringify({ policies: ['first.aleo', 'second.aleo'].map(program => ({ asset: { program }, target: { records: 2 } })) }))
    await inventory(['inspect', '--config', config, '--json'])
    expect(JSON.parse(stdout.join('\n')).inventories.map((item: any) => item.asset.program)).toEqual(['first.aleo', 'second.aleo'])
    expect(stdout.join('\n')).not.toContain('private-record-content')
  })
  it('honors explicit network, database, field, and environment-key overrides', async () => {
    vi.stubEnv('ALEO_PRIVATE_KEY', 'environment-key')
    await inventory(['plan', '--asset', 'points.aleo', '--record-name', 'Balance', '--amount-field', 'points', '--network', 'mainnet', '--database', join(directory, 'other.sqlite'), '--json'])
    expect(options[0]).toMatchObject({ network: 'mainnet', privateKey: 'environment-key', recordManagement: { chainId: 'aleo:mainnet' } })
    expect(JSON.parse(stdout.join('\n')).plans[0].asset).toMatchObject({ program: 'points.aleo', recordName: 'Balance', amountField: 'points' })
  })
  it('executes maintenance only with --execute and releases only the manager lease', async () => {
    await execution()
    await inventory(['rebalance', '--asset', 'credits.aleo', '--records', '2', '--execute', '--json'])
    expect(JSON.parse(stdout.join('\n')).results[0].result.transactionIds).toEqual(['at1confirmed'])
    expect(executions).toBe(1)
    expect((await entries()).map(entry => [entry.program, entry.status])).toEqual([
      ['__inventory_manager__', 'cancelled'], ['credits.aleo', 'confirmed'],
    ])
  })
  it('prints one JSON summary when a continuous run stops', async () => {
    await execution(true)
    await inventory(['run', '--asset', 'credits.aleo', '--execute', '--json'])
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({ cycles: 1, results: [{ status: 'complete' }] })
    expect((await entries())[0].status).toBe('cancelled')
  })
  it('reports status without exposing saved transaction payloads', async () => {
    const { sqliteRecordInventoryStore } = await import('../src/storage.js')
    const store = await sqliteRecordInventoryStore(database)
    await store.acquire({ scope: JSON.stringify(['aleo:testnet', 'aleo1fixture']), records: ['heldgroup'], program: 'token.aleo', function: 'join', status: 'prepared', createdAt: Date.now(), accountType: 'local', transactionId: 'at1saved', rebroadcastAttempts: 2, lastRebroadcastError: 'Serial number already spent',
      transaction: { id: 'at1saved', proof: 'stored-transaction-body' } as any })
    store.close()
    await inventory(['status', '--json'])
    expect(JSON.parse(stdout.join('\n')).operations[0]).toMatchObject({ status: 'prepared', transactionId: 'at1saved',
      rebroadcastAttempts: 2, lastRebroadcastError: 'Serial number already spent' })
    expect(stdout.join('\n')).not.toContain('stored-transaction-body')
    expect(executions).toBe(0)
  })
  it('rejects unknown flags before account initialization and returns JSON errors', async () => {
    await expect(inventory(['rebalance', '--recrods', '2', '--execute', '--json'])).rejects.toThrow('EXIT:64')
    expect(JSON.parse(stdout.join('\n')).error.message).toContain('--recrods')
    expect(options).toEqual([])
  })
  it('reports missing credentials without generating an account', async () => {
    vi.mocked(loadState).mockReturnValue({ network: 'testnet' })
    await inventory(['inspect', '--asset', 'credits.aleo', '--json'])
    expect(JSON.parse(stdout.join('\n')).error.message).toContain('shield-swap setup')
    expect(process.exitCode).toBe(1)
    expect(options).toEqual([])
  })
})
