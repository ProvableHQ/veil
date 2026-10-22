import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { sqliteRecordInventoryStore } from '../src/storage.js'
import type { RecordSpend } from '@provablehq/veil-core'

const exec = promisify(execFile)
const directories: string[] = []
const entry: Omit<RecordSpend, 'id'> = { scope: 'testnet/account', records: ['1group'], program: 'credits.aleo', function: 'join', status: 'reserved', createdAt: Date.now(), accountType: 'local' }
async function path() { const dir = await mkdtemp(join(tmpdir(), 'veil-inventory-')); directories.push(dir); return join(dir, 'journal.sqlite') }
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
const moduleUrl = new URL('../src/storage.ts', import.meta.url).href
const child = async (database: string, body: string) => exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
  `import { sqliteRecordInventoryStore } from ${JSON.stringify(moduleUrl)}; const store = await sqliteRecordInventoryStore(${JSON.stringify(database)}); ${body}; store.close();`], { cwd: resolve('.') })

describe('CLI-only durable inventory store', () => {
  it('reserves atomically across independent database connections and isolates accounts', async () => {
    const database = await path()
    const a = await sqliteRecordInventoryStore(database)
    const b = await sqliteRecordInventoryStore(database)
    try {
      const results = await Promise.all([a.acquire(entry), b.acquire(entry)])
      expect(results.filter(Boolean)).toHaveLength(1)
      expect(await b.acquire({ ...entry, scope: 'mainnet/account' })).toBeDefined()
      expect((await stat(database)).mode & 0o777).toBe(0o600)
      await a.update(entry.scope, results.find(Boolean)!.id, { status: 'confirmed' })
      expect(await b.acquire(entry)).toBeUndefined() // A stale scan must not resurrect spent inputs.
    } finally { a.close(); b.close() }
  })
  it('serializes acquisition from separate processes', async () => {
    const database = await path()
    const store = await sqliteRecordInventoryStore(database); store.close()
    const body = `const entry = await store.acquire(${JSON.stringify({ ...entry, accountType: 'rpc' })}); console.log(entry ? 'acquired' : 'busy')`
    const results = await Promise.all([child(database, body), child(database, body)])
    expect(results.map((result) => result.stdout.trim()).sort()).toEqual(['acquired', 'busy'])
  })
  it('releases abandoned local pre-proving reservations but retains prepared transactions', async () => {
    const database = await path()
    await child(database, `await store.acquire(${JSON.stringify(entry)})`)
    let store = await sqliteRecordInventoryStore(database)
    expect((await store.list(entry.scope))[0]?.status).toBe('cancelled')
    store.close()
    await child(database, `const e = await store.acquire(${JSON.stringify(entry)}); await store.update(e.scope, e.id, { status: 'prepared', transactionId: 'at1saved', transaction: { id: 'at1saved', type: 'execute' } })`)
    store = await sqliteRecordInventoryStore(database)
    try {
      expect((await store.list(entry.scope)).at(-1)).toMatchObject({ status: 'prepared', transactionId: 'at1saved', transaction: { id: 'at1saved' } })
      expect(await store.acquire(entry)).toBeUndefined()
    } finally { store.close() }
  })
  it('retains an opaque wallet reservation after its process exits', async () => {
    const database = await path()
    await child(database, `await store.acquire(${JSON.stringify({ ...entry, accountType: 'rpc' })})`)
    const store = await sqliteRecordInventoryStore(database)
    try { expect((await store.list(entry.scope))[0]?.status).toBe('reserved') }
    finally { store.close() }
  })
})
