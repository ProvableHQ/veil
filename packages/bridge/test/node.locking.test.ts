import { expect, it, vi } from 'vitest'
import { hostname, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const race = vi.hoisted(() => {
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => { resolve = r })
    return { promise, resolve }
  }
  return {
    token: '', reads: 0, unlinks: 0,
    bothRead: deferred(), firstEntered: deferred(), secondUnlinked: deferred(),
  }
})

// Delay real filesystem operations so both contenders observe the same dead
// owner, then make the second cleanup run after a new owner has acquired it.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const value = await fs.readFile(...args)
      if (race.token && String(value).includes(race.token)) {
        if (++race.reads === 2) race.bothRead.resolve()
        await race.bothRead.promise
      }
      return value
    },
    unlink: async (path: string) => {
      if (race.token && basename(path) === `owner.${race.token}.json` && ++race.unlinks === 2) {
        await race.firstEntered.promise
        try {
          return await fs.unlink(path)
        } finally {
          race.secondUnlinked.resolve()
        }
      }
      return fs.unlink(path)
    },
  }
})

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileXReservePrivateMintIdentityStore } from '../src/node.js'

it('preserves a replacement lock when concurrent contenders reclaim the same dead owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veil-stale-lock-'))
  const path = join(directory, 'identities.json')
  const deadPid = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout)
  expect(deadPid).toBeGreaterThan(0)
  race.token = randomUUID()
  await mkdir(`${path}.lock`)
  await writeFile(join(`${path}.lock`, `owner.${race.token}.json`), JSON.stringify({
    token: race.token, pid: deadPid, hostname: hostname(), createdAt: Date.now(),
  }))
  const stores = [fileXReservePrivateMintIdentityStore(path), fileXReservePrivateMintIdentityStore(path)]
  let active = 0
  let maxActive = 0
  let entries = 0
  try {
    const counters = await Promise.all(stores.map((store) => store.runExclusive!(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      if (++entries === 1) {
        race.firstEntered.resolve()
        await race.secondUnlinked.promise
        // The stale contender has attempted cleanup while this lock is live.
        expect((await stat(`${path}.lock`)).isDirectory()).toBe(true)
      }
      const next = await store.allocateCounter!(0)
      active--
      return next
    })))
    expect(maxActive).toBe(1)
    expect(counters.sort()).toEqual([0, 1])
    expect(JSON.parse(await readFile(`${path}.counter`, 'utf8'))).toBe(2)
    await expect(stat(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    race.token = ''
    await rm(directory, { recursive: true, force: true })
  }
}, 10_000)
