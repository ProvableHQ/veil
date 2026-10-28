import { mkdir, open, readFile, readdir, rename, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BridgeError } from './errors/bridgeErrors.js'
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
 * a filesystem lock across store instances and Node processes. A companion
 * `.counter` file permanently consumes allocations before derivation. Both files
 * MUST be backed up and restored together before issuing further identities.
 * Locks belonging to a confirmed dead process on this host are reclaimed by
 * removing its unique owner file. Foreign-host and unrecognized locks require
 * operator verification; elapsed time alone never authorizes their removal.
 *
 * @param path File that persists the monotonically allocated identities.
 * @returns A store suitable for `createBridgeClient({ circle: { privateMintIdentities } })`.
 * @example
 * import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'
 * import { fileXReservePrivateMintIdentityStore } from '@provablehq/aleo-bridge-sdk/node'
 * const bridge = createBridgeClient({
 *   circle: { privateMintIdentities: fileXReservePrivateMintIdentityStore('.veil/mints.json') },
 * })
 */
export function fileXReservePrivateMintIdentityStore(
  path: string,
): XReservePrivateMintIdentityStore {
  const directory = dirname(path)
  const lockPath = `${path}.lock`
  const store: XReservePrivateMintIdentityStore = {
    allocateCounter: async (minimum) => {
      let nextCounter = minimum
      try {
        const persisted: unknown = JSON.parse(await readFile(`${path}.counter`, 'utf8'))
        if (typeof persisted !== 'number' || !Number.isSafeInteger(persisted)
          || persisted < 0 || persisted > 0x1_0000_0000) {
          throw new BridgeError('Private mint identity counter watermark is invalid')
        }
        nextCounter = Math.max(minimum, persisted)
      } catch (cause) {
        if ((cause as { code?: string } | undefined)?.code !== 'ENOENT') throw cause
      }
      if (nextCounter > 0xffffffff) throw new BridgeError('Private mint identity counter space is exhausted')
      // The caller holds the file lock throughout allocation, derivation, and
      // identity persistence. A failed mint never lowers this watermark.
      await atomicWrite(`${path}.counter`, `${nextCounter + 1}\n`)
      return nextCounter
    },
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
      try {
        // Replacing rather than overwriting guarantees that an existing file
        // with broader permissions becomes a newly created 0600 inode.
        await atomicWrite(path, serialized)
      } catch (cause) {
        throw new Error(`Private mint identity store ${path} could not be saved.`, { cause })
      }
    },
  }
  store.runExclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    await mkdir(directory, { recursive: true })
    const owner = { token: randomUUID(), pid: process.pid, hostname: hostname(), createdAt: Date.now() }
    const candidate = `${lockPath}.${owner.token}.tmp`
    const deadline = Date.now() + 30_000
    await mkdir(candidate, { mode: 0o700 })
    let published = false
    try {
      // Publish the directory only after its unique owner file is complete.
      // An empty shared lock directory can then only belong to a released or
      // interrupted cleanup, never a live owner still initializing its lock.
      const handle = await open(join(candidate, ownerFilename(owner.token)), 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(owner), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      while (true) {
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for private mint identity lock ${lockPath}.`)
        }
        try {
          await rename(candidate, lockPath)
          published = true
          break
        } catch (cause) {
          const code = (cause as { code?: string } | undefined)?.code
          if (!['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR', 'EPERM'].includes(code ?? '')) {
            throw new Error(`Private mint identity lock ${lockPath} failed.`, { cause })
          }
          const occupant = await stat(lockPath).catch((error) => {
            if ((error as { code?: string }).code === 'ENOENT') return undefined
            throw error
          })
          if (occupant === undefined) {
            if (code === 'EPERM') throw cause
            continue
          }
          if (!occupant.isDirectory()) {
            throw new Error(`Private mint identity lock ${lockPath} is occupied by a file that is not a lock directory. Remove it before reserving identities.`)
          }
          if (await reclaimAbandonedLock(lockPath)) continue
          await new Promise<void>((resolve) => setTimeout(resolve, 25))
        }
      }
    } finally {
      // This path is private to this contender, so recursive cleanup cannot
      // remove a different owner's published lock.
      if (!published) await rm(candidate, { recursive: true, force: true })
    }
    try {
      return await action()
    } finally {
      await releaseOwnedLock(lockPath, owner.token)
    }
  }
  return store
}

async function atomicWrite(path: string, serialized: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
    // Persist the rename before returning a consumed counter to the caller.
    await syncDirectory(directory)
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true })
  }
}

/**
 * Flushes a directory entry so a completed rename survives a crash.
 *
 * Windows cannot fsync a directory handle and some filesystems reject it;
 * those platforms provide no stronger guarantee, so the failure is ignored
 * rather than making the store unusable.
 */
async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (cause) {
    const code = (cause as { code?: string } | undefined)?.code
    if (code !== 'EPERM' && code !== 'EISDIR' && code !== 'EINVAL' && code !== 'ENOTSUP') throw cause
  } finally {
    await handle?.close().catch(() => {})
  }
}

type LockOwner = { token: string, pid: number, hostname: string, createdAt: number }

function ownerFilename(token: string): string {
  return `owner.${token}.json`
}

/** Removes only a positively identified dead owner's file, leaving replacement owners intact. */
async function reclaimAbandonedLock(lockPath: string): Promise<boolean> {
  let files: string[]
  try {
    files = await readdir(lockPath)
  } catch (cause) {
    if ((cause as { code?: string }).code === 'ENOENT') return true
    throw cause
  }
  if (files.length === 0) {
    await removeEmptyLock(lockPath)
    return true
  }
  const match = files.length === 1 ? /^owner\.([0-9a-f-]{36})\.json$/.exec(files[0]!) : null
  const invalidOwner = () => new Error(`Private mint identity lock ${lockPath} has an unrecognized owner. Stop all users of this store before removing the lock directory.`)
  if (!match) throw invalidOwner()
  let owner: LockOwner
  try {
    owner = JSON.parse(await readFile(join(lockPath, files[0]!), 'utf8')) as LockOwner
  } catch (cause) {
    if ((cause as { code?: string }).code === 'ENOENT') return true
    throw invalidOwner()
  }
  if (!owner || owner.token !== match[1] || typeof owner.hostname !== 'string'
    || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw invalidOwner()
  // An elapsed timeout cannot prove that a process on another host is dead.
  if (owner.hostname !== hostname()) return false
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (cause) {
    if ((cause as { code?: string }).code !== 'ESRCH') return false
  }
  await releaseOwnedLock(lockPath, owner.token)
  return true
}

async function releaseOwnedLock(lockPath: string, token: string): Promise<void> {
  // Unlinking a token-specific name is the ownership check: a stale contender
  // cannot unlink a newer owner's file, even after the shared path is reused.
  try {
    await unlink(join(lockPath, ownerFilename(token)))
  } catch (cause) {
    if ((cause as { code?: string }).code === 'ENOENT') return
    throw cause
  }
  await removeEmptyLock(lockPath)
}

async function removeEmptyLock(lockPath: string): Promise<void> {
  try {
    await rmdir(lockPath)
  } catch (cause) {
    // A replacement lock is nonempty and MUST remain in place. An absent path
    // means another contender already finished the same empty-lock cleanup.
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((cause as { code?: string }).code ?? '')) throw cause
  }
}

export type {
  XReservePrivateMintIdentity,
  XReservePrivateMintIdentityStore,
} from './utils/xreservePrivateMintStore.js'
