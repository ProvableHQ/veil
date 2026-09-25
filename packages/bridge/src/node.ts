import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  XReservePrivateMintIdentity,
  XReservePrivateMintIdentityStore,
} from './utils/xreservePrivateMintStore.js'

/**
 * Builds a private-mint identity store backed by a JSON file.
 *
 * The file contains view-key-derived scalars and should be protected like the
 * account's view key. Parent directories are created on first save. Each save
 * atomically replaces the destination with a `0600` file, and reservations use
 * a filesystem lock across store instances and Node processes.
 *
 * @param path File that persists the monotonically allocated identities.
 * @returns A store suitable for `createBridgeClient({ privateMintIdentities })`.
 */
export function fileXReservePrivateMintIdentityStore(
  path: string,
): XReservePrivateMintIdentityStore {
  const directory = dirname(path)
  const lockPath = `${path}.lock`
  const store: XReservePrivateMintIdentityStore = {
    load: async () => {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (cause) {
        if ((cause as { code?: string } | undefined)?.code === 'ENOENT') return []
        throw new Error(`Private mint identity store ${path} could not be read.`, { cause })
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        throw new Error(`Private mint identity store ${path} is not valid JSON.`, { cause })
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`Private mint identity store ${path} does not hold an array of identities.`)
      }
      return parsed as XReservePrivateMintIdentity[]
    },
    save: async (identities) => {
      const serialized = `${JSON.stringify(identities, null, 2)}\n`
      await mkdir(directory, { recursive: true })
      const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
      let handle: Awaited<ReturnType<typeof open>> | undefined
      try {
        handle = await open(temporary, 'wx', 0o600)
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
        await handle.close()
        handle = undefined
        // Replacing rather than overwriting guarantees that an existing file
        // with broader permissions becomes a newly created 0600 inode.
        await rename(temporary, path)
      } catch (cause) {
        await handle?.close().catch(() => {})
        await rm(temporary, { force: true }).catch(() => {})
        throw new Error(`Private mint identity store ${path} could not be saved.`, { cause })
      }
    },
  }
  store.runExclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    await mkdir(directory, { recursive: true })
    const owner = { token: randomUUID(), pid: process.pid, hostname: hostname(), createdAt: Date.now() }
    const deadline = Date.now() + 30_000
    while (true) {
      let createdLock = false
      try {
        await mkdir(lockPath, { mode: 0o700 })
        createdLock = true
        const ownerFile = join(lockPath, 'owner.json')
        const handle = await open(ownerFile, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify(owner), 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        break
      } catch (cause) {
        if (createdLock) {
          await rm(lockPath, { recursive: true, force: true }).catch(() => {})
          throw new Error(`Private mint identity lock ${lockPath} could not be initialized.`, { cause })
        }
        const code = (cause as { code?: string } | undefined)?.code
        if (code !== 'EEXIST') {
          // A contender may observe the directory between its creation and the
          // owner file write. Treat that short window as an active lock.
          if (code !== 'ENOENT') throw new Error(`Private mint identity lock ${lockPath} failed.`, { cause })
        }
        if (await lockIsAbandoned(lockPath)) {
          const abandoned = `${lockPath}.abandoned.${randomUUID()}`
          try {
            await rename(lockPath, abandoned)
            await rm(abandoned, { recursive: true, force: true })
          } catch (reclaimCause) {
            const reclaimCode = (reclaimCause as { code?: string } | undefined)?.code
            if (reclaimCode !== 'ENOENT') throw reclaimCause
          }
          continue
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for private mint identity lock ${lockPath}.`)
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 25))
      }
    }
    try {
      return await action()
    } finally {
      await releaseOwnedLock(lockPath, owner.token)
    }
  }
  return store
}

const STALE_LOCK_MS = 5 * 60_000

type LockOwner = { token: string, pid: number, hostname: string, createdAt: number }

async function lockIsAbandoned(lockPath: string): Promise<boolean> {
  let owner: LockOwner
  try {
    owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as LockOwner
  } catch {
    try {
      return Date.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS
    } catch {
      return false
    }
  }
  if (owner.hostname === hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
    try {
      process.kill(owner.pid, 0)
      return false
    } catch (cause) {
      return (cause as { code?: string } | undefined)?.code === 'ESRCH'
    }
  }
  return Number.isFinite(owner.createdAt) && Date.now() - owner.createdAt > STALE_LOCK_MS
}

async function releaseOwnedLock(lockPath: string, token: string): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as LockOwner
    if (owner.token === token) await rm(lockPath, { recursive: true, force: true })
  } catch (cause) {
    if ((cause as { code?: string } | undefined)?.code !== 'ENOENT') throw cause
  }
}

export type {
  XReservePrivateMintIdentity,
  XReservePrivateMintIdentityStore,
} from './utils/xreservePrivateMintStore.js'
