import { mkdir, open, lstat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hostname } from 'node:os'
import type { RecordInventoryStore, RecordSpend } from '@provablehq/veil-core'

/**
 * Builds a durable SQLite journal with atomic record reservations across processes.
 * Requires Node 22.13 or newer only when called; imports node:sqlite lazily.
 * The database contains record nonces and proved transactions, never plaintext records or keys.
 * @param path SQLite database file, created with mode 0600; parent directories use 0700.
 * @returns A shared store with close() to release its database handle.
 * @throws On unsupported Node versions, corrupt data, non-regular files, or database errors.
 * @example
 * const store = await sqliteRecordInventoryStore('.veil/inventory.sqlite')
 * const client = walletClient.extend(recordActions({ store, chainId: 'aleo:testnet' }))
 */
export async function sqliteRecordInventoryStore(path: string): Promise<RecordInventoryStore & { close(): void }> {
  const { DatabaseSync } = await import('node:sqlite')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try { const file = await open(path, 'wx', 0o600); await file.close() }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Inventory database must be a regular file with mode 0600')
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
  db.exec(`CREATE TABLE IF NOT EXISTS record_spends (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, data TEXT NOT NULL,
    pid INTEGER NOT NULL, host TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS record_spends_scope ON record_spends(scope);`)
  const host = hostname()
  const read = (scope: string): RecordSpend[] => db.prepare('SELECT data FROM record_spends WHERE scope = ? ORDER BY id').all(scope).map((row) => {
    const entry = JSON.parse(row.data as string) as RecordSpend
    if (!entry.id || entry.scope !== scope || !Array.isArray(entry.records)) throw new Error('Invalid inventory journal entry')
    return entry
  })
  const transaction = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  const update = (scope: string, id: string, patch: Parameters<RecordInventoryStore['update']>[2]) => {
    const row = db.prepare('SELECT data FROM record_spends WHERE scope = ? AND id = ?').get(scope, id)
    if (!row) throw new Error('Unknown inventory reservation')
    const entry = { ...JSON.parse(row.data as string), ...patch }
    db.prepare('UPDATE record_spends SET data = ? WHERE scope = ? AND id = ?').run(JSON.stringify(entry), scope, id)
  }
  const recover = (scope: string) => {
    for (const row of db.prepare('SELECT id, data, pid, host FROM record_spends WHERE scope = ?').all(scope)) {
      const entry = JSON.parse(row.data as string) as RecordSpend
      // A dead local process could not have submitted before persisting prepared.
      // Wallet calls are opaque and must never be unlocked using process liveness.
      if (entry.status !== 'reserved' || entry.accountType !== 'local' || row.host !== host) continue
      try { process.kill(Number(row.pid), 0) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') update(scope, String(row.id), { status: 'cancelled' })
      }
    }
  }
  return {
    list: async (scope) => transaction(() => { recover(scope); return read(scope) }),
    acquire: async (entry) => transaction(() => {
      recover(entry.scope)
      if (new Set(entry.records).size !== entry.records.length) throw new Error('Duplicate record inputs')
      if (read(entry.scope).some((old) => old.status !== 'cancelled' && old.status !== 'rejected' &&
        old.records.some((id) => entry.records.includes(id)))) return undefined
      const inserted = db.prepare('INSERT INTO record_spends(scope, data, pid, host) VALUES (?, ?, ?, ?)').run(
        entry.scope, JSON.stringify(entry), process.pid, host)
      const saved = { ...entry, id: String(inserted.lastInsertRowid) }
      db.prepare('UPDATE record_spends SET data = ? WHERE id = ?').run(JSON.stringify(saved), saved.id)
      return saved
    }),
    update: async (scope, id, patch) => transaction(() => update(scope, id, patch)),
    close: () => db.close(),
  }
}
