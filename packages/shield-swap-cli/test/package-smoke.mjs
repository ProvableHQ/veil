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

test('built binary runs the account commands against an empty accounts directory', async () => {
  // A sealed environment: no key, account or password variable of the caller
  // reaches the child, and its home is a temporary directory.
  const directory = await mkdtemp(join(tmpdir(), 'shield-account-package-'))
  const env = { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory, NO_COLOR: '1',
    ALEO_ACCOUNTS_DIR: join(directory, 'accounts'), SHIELD_SWAP_STATE_DIR: join(directory, 'state') }
  const account = (...argv) => exec(process.execPath, [binary, 'account', ...argv], { env })
    .then(result => ({ code: 0, ...result }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }))
  try {
    assert.match((await exec(process.execPath, [binary, '--help'])).stdout, /account/)
    assert.match((await account('--help')).stdout, /create[\s\S]*import[\s\S]*show[\s\S]*protect[\s\S]*export[\s\S]*migrate/)

    // No account yet: a person is needed, and the error is one JSON object.
    const missing = await account('show', '--json')
    assert.equal(missing.code, 2)
    assert.equal(JSON.parse(missing.stdout).error.code, 'ACCOUNT_NOT_FOUND')

    const created = await account('create', '--json')
    assert.equal(created.code, 0)
    const stored = JSON.parse(created.stdout)
    assert.deepEqual(Object.keys(stored), ['name', 'address', 'storage', 'path'])
    assert.equal(stored.storage, 'plaintext')
    assert.doesNotMatch(created.stdout + created.stderr, /APrivateKey1/)
    assert.deepEqual(JSON.parse((await account('show', '--json')).stdout), stored)

    // Not a terminal: the key is not printed.
    const exported = await account('export')
    assert.equal(exported.code, 2)
    assert.match(exported.stderr, /^TERMINAL_REQUIRED: /)
    assert.equal(exported.stdout, '')

    const usage = await account('show', '--unknown')
    assert.equal(usage.code, 64)
    assert.match(usage.stderr, /Usage:/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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
