import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  XReservePrivateMintIdentity,
  XReservePrivateMintIdentityStore,
} from './utils/xreservePrivateMintStore.js'

/**
 * Builds a private-mint identity store backed by a JSON file.
 *
 * The file contains view-key-derived scalars and should be protected like the
 * account's view key. Parent directories are created on first save and the file
 * is written with mode `0600`.
 *
 * @param path File that persists the monotonically allocated identities.
 * @returns A store suitable for `createBridgeClient({ privateMintIdentities })`.
 */
export function fileXReservePrivateMintIdentityStore(
  path: string,
): XReservePrivateMintIdentityStore {
  return {
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
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${JSON.stringify(identities, null, 2)}\n`, { mode: 0o600 })
    },
  }
}

export type {
  XReservePrivateMintIdentity,
  XReservePrivateMintIdentityStore,
} from './utils/xreservePrivateMintStore.js'
