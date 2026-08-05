import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BlindedIdentityRecord, BlindedIdentityStore } from './utils/blinding/store.js'

/**
 * Node-only entry point: stores that persist to the filesystem.
 *
 * Kept off the package root so browser and React Native bundles never resolve
 * `node:fs`.
 */

/**
 * Builds a blinded-identity store backed by a JSON file.
 *
 * Reservations survive restarts, so the next run continues from the highest
 * counter it already knows instead of rescanning the chain for the frontier.
 * Applies to bots, servers, and test suites — anything that swaps repeatedly
 * from one local account.
 *
 * The file holds blinding factors, which are derivable from the account's view
 * key and therefore no more sensitive than it, but do link swaps to the
 * account. It is written `0600`, and parent directories are created on first
 * save.
 *
 * @param path File to read and write. Created on first save.
 * @returns A store persisting to `path`. Every call hits the filesystem.
 *
 * @example
 * import { fileBlindedIdentityStore } from '@provablehq/shield-swap-sdk/node'
 *
 * const client = walletClient.extend(
 *   shieldSwapActions({ api: {}, blindedIdentities: fileBlindedIdentityStore('.veil/blinded.json') }),
 * )
 */
export function fileBlindedIdentityStore(path: string): BlindedIdentityStore {
  return {
    load: async () => {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (cause) {
        // Only a genuinely absent file reads as "nothing reserved yet". Any
        // other read failure is reported, because treating it as empty would
        // restart counters at 0 and re-derive identities that are already in
        // flight — the collision this store exists to prevent.
        const code = (cause as { code?: string } | undefined)?.code
        // ENOENT only. ENOTDIR means a component of the path is not a
        // directory — a malformed path, not a missing file — and treating that
        // as empty would restart counters at 0 against a store that may well
        // exist somewhere else.
        if (code === 'ENOENT') return []
        throw new Error(
          `Blinded identity store ${path} could not be read (${code ?? 'unknown error'}). ` +
            'Refusing to restart counters, which would collide with reservations recorded there.',
          { cause },
        )
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        throw new Error(`Blinded identity store ${path} is not valid JSON.`, { cause })
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`Blinded identity store ${path} does not hold an array of records.`)
      }
      return parsed as BlindedIdentityRecord[]
    },
    save: async (records) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
    },
  }
}
