import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadPrivateKey, reserveSwap } from './state.js'

test('reuses the generated account after a restart and protects its file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'first-swap-'))
  try {
    const file = join(directory, 'account.json')
    assert.equal(await loadPrivateKey(file, undefined, () => 'test-key'), 'test-key')
    assert.equal(await loadPrivateKey(file, undefined, () => {
      throw new Error('Must not generate another account')
    }), 'test-key')
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('uses an explicitly supplied key without overwriting the saved account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'first-swap-'))
  try {
    const file = join(directory, 'account.json')
    await loadPrivateKey(file, undefined, () => 'saved-key')
    const before = await readFile(file, 'utf8')
    assert.equal(await loadPrivateKey(file, 'provided-key', () => 'unused'), 'provided-key')
    assert.equal(await readFile(file, 'utf8'), before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('does not replace an unreadable account with a new one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'first-swap-'))
  try {
    const file = join(directory, 'account.json')
    await writeFile(file, '{broken')
    await assert.rejects(loadPrivateKey(file, undefined, () => 'replacement'))
    await writeFile(file, '{}')
    await assert.rejects(loadPrivateKey(file, undefined, () => 'replacement'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('refuses a second swap after submission starts, including across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'first-swap-'))
  try {
    const file = join(directory, 'submitted.json')
    await reserveSwap(file, { network: 'testnet' })
    await assert.rejects(reserveSwap(file, { network: 'testnet' }), /npm run claim/)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { network: 'testnet' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
