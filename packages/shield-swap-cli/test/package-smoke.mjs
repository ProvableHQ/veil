import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const exec = promisify(execFile)
const binary = fileURLToPath(new URL('../dist/index.js', import.meta.url))

test('built binary lists inventory and loads its help', async () => {
  const top = await exec(process.execPath, [binary, '--help'])
  assert.match(top.stdout, /inventory/)
  const child = await exec(process.execPath, [binary, 'inventory', '--help'])
  assert.match(child.stdout, /inspect\|plan\|rebalance\|run\|status/)
})

test('published storage entry point opens and reopens a durable journal', async () => {
  // Resolve through package exports and execute the bundle. Source-level tests
  // cannot catch a bundler rewriting node:sqlite to an npm package import.
  const { sqliteRecordInventoryStore } = await import('@provablehq/shield-swap-cli/storage')
  const directory = await mkdtemp(join(tmpdir(), 'shield-inventory-package-'))
  let store
  try {
    const database = join(directory, 'inventory.sqlite')
    store = await sqliteRecordInventoryStore(database)
    const saved = await store.acquire({ scope: 'package-smoke', records: ['nonce'], program: 'credits.aleo',
      function: 'join', status: 'prepared', createdAt: Date.now(), accountType: 'local' })
    store.close()
    store = await sqliteRecordInventoryStore(database)
    assert.equal((await store.list('package-smoke'))[0].id, saved.id)
    assert.equal(await store.acquire({ ...saved, id: undefined }), undefined)
  } finally {
    store?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
