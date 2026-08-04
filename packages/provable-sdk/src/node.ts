/**
 * Node-only helpers for `@provablehq/veil-aleo-sdk`.
 *
 * Imported from `@provablehq/veil-aleo-sdk/node` rather than the package root,
 * so the `node:fs` dependency never reaches a browser bundle.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProvableApiCredentials, ProvableCredentialStore } from './provableApi.js'

/**
 * Builds a credential store backed by a JSON file.
 *
 * Applies to bots, scripts, servers, and CI — anything holding a private key
 * directly and able to write to disk. The file is written with mode `0600`
 * because it holds an API key the Provable API issues exactly once and cannot
 * reissue. A missing file reads as "not registered yet", so the first run
 * registers a consumer and writes it, and later runs reuse it.
 *
 * @param path Path to the JSON file. Parent directories are created on write.
 * @returns A store reading and writing that file.
 * @throws From `load` when the file exists but cannot be read or parsed. Only an
 *   absent file counts as "not registered": any other failure could otherwise
 *   register a replacement consumer and abandon the unreissuable key in that
 *   file.
 * @throws From `save` when the write fails — a swallowed failure would orphan a
 *   consumer whose key is unrecoverable, so it propagates and fails the call
 *   that triggered registration.
 *
 * @example
 * import { fileCredentialStore } from '@provablehq/veil-aleo-sdk/node'
 *
 * const { walletClient } = aleo.createAleoClient({
 *   privateKey, networkUrl, proverUrl, records: scanner,
 *   credentialStore: fileCredentialStore('./.provable-credentials.json'),
 * })
 */
export function fileCredentialStore(path: string): ProvableCredentialStore {
  return {
    load: async () => {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (cause) {
        // Only a genuinely absent file reads as "no consumer yet". Any other
        // read failure — a permissions change, a busy or unreadable device — is
        // reported, because treating it as absent would register a replacement
        // consumer and abandon the key sitting in that file, which cannot be
        // reissued. Same reasoning as the malformed-file case below.
        const code = (cause as { code?: string } | undefined)?.code
        if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
        throw new Error(
          `Provable API credential file ${path} could not be read (${code ?? 'unknown error'}). ` +
            'Refusing to register a replacement consumer, which would abandon any key stored there.',
          { cause },
        )
      }
      // A malformed or half-written file is reported rather than treated as
      // absent: registering over it would overwrite credentials that may still
      // be recoverable by hand, and the key cannot be reissued.
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        throw new Error(`Provable API credential file ${path} is not valid JSON.`, { cause })
      }
      const { consumerId, apiKey } = (parsed ?? {}) as Partial<ProvableApiCredentials>
      if (typeof consumerId !== 'string' || typeof apiKey !== 'string') {
        throw new Error(
          `Provable API credential file ${path} is missing consumerId or apiKey. Delete it to register a new consumer.`,
        )
      }
      return { consumerId, apiKey }
    },
    save: async (credentials) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
    },
  }
}
