import { randomBytes } from 'node:crypto'
import { chmod, link, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  SALT_BYTES,
  SCRYPT_MAX_N,
  SCRYPT_MIN_N,
  SCRYPT_P,
  SCRYPT_R,
  type EncryptedKey,
} from './encrypted.js'
import { KeystoreError } from './errors.js'
import { KEY_SERVICE } from './keychain.js'
import { runtime } from './runtime.js'

/** Format version written to, and accepted from, an account file. */
const FILE_VERSION = 1

/** Account names: lower case so they are distinct on case-insensitive disks. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Standard base64 with padding, the only salt encoding accepted. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** The four ways an account file can hold, or point at, the private key. */
export const STORAGE_TYPES = ['none', 'plaintext', 'keychain', 'encrypted'] as const

/** The `key` object of an account file, one variant per storage type. */
export type KeyEntry =
  | { type: 'none' }
  | { type: 'plaintext'; privateKey: string }
  | { type: 'keychain'; service: string; account: string }
  | EncryptedKey

/**
 * The parsed content of an account file.
 *
 * @property version Format version. Always 1.
 * @property address Aleo address of the account.
 * @property key Where the private key is, by storage type.
 */
export type AccountFile = { version: number; address: string; key: KeyEntry }

/**
 * A resolved account file location.
 *
 * @property name Account name.
 * @property dir Absolute path of the accounts directory.
 * @property path Absolute path of the account file, `<dir>/<name>.json`.
 */
export type Location = { name: string; dir: string; path: string }

/**
 * Resolves which account file a call refers to.
 *
 * The name comes from the argument, then `ALEO_ACCOUNT`, then `default`. The
 * directory comes from the argument, then `ALEO_ACCOUNTS_DIR`, then
 * `<home>/.aleo/accounts`; a leading `~` expands to the home directory. An
 * empty variable or an empty `dir` counts as absent. Reads the environment and
 * does not touch the disk.
 *
 * @param options Optional explicit `name` and `dir`.
 * @returns The account name and the absolute directory and file paths.
 * @throws KeystoreError `INVALID_NAME` when the name does not match
 *   `^[a-z0-9][a-z0-9_-]{0,63}$`.
 */
export function resolveLocation(options?: { name?: string; dir?: string }): Location {
  const name = options?.name ?? (process.env.ALEO_ACCOUNT || 'default')
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new KeystoreError(
      'INVALID_NAME',
      'The account name must be 1 to 64 characters of a-z, 0-9, "_" or "-", starting with a letter or digit.',
    )
  }
  const home = runtime.homedir()
  let dir = options?.dir || process.env.ALEO_ACCOUNTS_DIR || join(home, '.aleo', 'accounts')
  // Only "~" and "~/..." expand; "~name" is left as an ordinary directory name.
  if (dir === '~') dir = home
  else if (dir.startsWith('~/') || (runtime.platform === 'win32' && dir.startsWith('~\\'))) dir = join(home, dir.slice(2))
  dir = resolve(dir)
  return { name, dir, path: join(dir, `${name}.json`) }
}

/** Narrows a parsed JSON value to an object that is not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses and validates the text of an account file.
 *
 * Accepts exactly the fields of the format: no field may be missing and none
 * may be added. An unknown version or storage type is reported as such before
 * the remaining fields are examined, since a later format may carry others.
 *
 * @param text File content.
 * @param path File path, named in error messages.
 * @returns The validated content.
 * @throws KeystoreError `INVALID_ACCOUNT_FILE`, `UNSUPPORTED_VERSION` or
 *   `UNSUPPORTED_STORAGE`.
 */
export function parseAccountFile(text: string, path: string): AccountFile {
  const invalid = (problem: string) =>
    new KeystoreError('INVALID_ACCOUNT_FILE', `Account file ${path} is not valid: ${problem}.`)
  // Requires an object to hold exactly the named fields.
  const exact = (object: Record<string, unknown>, fields: readonly string[], where: string) => {
    for (const field of fields) if (!(field in object)) throw invalid(`${where} is missing "${field}"`)
    for (const field of Object.keys(object)) {
      if (!fields.includes(field)) throw invalid(`${where} has the unknown field "${field}"`)
    }
  }
  const str = (value: unknown, field: string): string => {
    if (typeof value !== 'string') throw invalid(`"${field}" must be a string`)
    return value
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // The parser's message can quote the file, which may hold a key.
    throw invalid('it is not JSON')
  }
  if (!isRecord(raw)) throw invalid('it does not hold a JSON object')

  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) throw invalid('"version" must be an integer')
  if (raw.version !== FILE_VERSION) {
    throw new KeystoreError(
      'UNSUPPORTED_VERSION',
      `Account file ${path} has version ${raw.version}; this reader supports version ${FILE_VERSION}.`,
    )
  }
  exact(raw, ['version', 'address', 'key'], 'the file')
  const address = str(raw.address, 'address')
  const key = raw.key
  if (!isRecord(key)) throw invalid('"key" must be an object')
  const type = str(key.type, 'key.type')

  switch (type) {
    case 'none':
      exact(key, ['type'], '"key"')
      return { version: FILE_VERSION, address, key: { type } }
    case 'plaintext':
      exact(key, ['type', 'privateKey'], '"key"')
      return { version: FILE_VERSION, address, key: { type, privateKey: str(key.privateKey, 'key.privateKey') } }
    case 'keychain': {
      exact(key, ['type', 'service', 'account'], '"key"')
      const service = str(key.service, 'key.service')
      const account = str(key.account, 'key.account')
      // Pinned so a crafted file cannot direct the reader to another entry.
      if (service !== KEY_SERVICE) throw invalid(`"key.service" must be "${KEY_SERVICE}"`)
      if (account !== address) throw invalid('"key.account" must equal "address"')
      return { version: FILE_VERSION, address, key: { type, service, account } }
    }
    case 'encrypted': {
      exact(key, ['type', 'kdf', 'kdfParams', 'ciphertext'], '"key"')
      if (key.kdf !== 'scrypt') throw invalid('"key.kdf" must be "scrypt"')
      const params = key.kdfParams
      if (!isRecord(params)) throw invalid('"key.kdfParams" must be an object')
      exact(params, ['N', 'r', 'p', 'salt'], '"key.kdfParams"')
      const { N, r, p } = params
      // The upper bound stops a crafted file from demanding unbounded memory.
      if (
        typeof N !== 'number' || !Number.isInteger(N) ||
        N < SCRYPT_MIN_N || N > SCRYPT_MAX_N || (N & (N - 1)) !== 0
      ) {
        throw invalid(`"key.kdfParams.N" must be a power of two from ${SCRYPT_MIN_N} to ${SCRYPT_MAX_N}`)
      }
      if (r !== SCRYPT_R) throw invalid(`"key.kdfParams.r" must be ${SCRYPT_R}`)
      if (p !== SCRYPT_P) throw invalid(`"key.kdfParams.p" must be ${SCRYPT_P}`)
      const salt = str(params.salt, 'key.kdfParams.salt')
      if (!BASE64_PATTERN.test(salt) || Buffer.from(salt, 'base64').length < SALT_BYTES) {
        throw invalid(`"key.kdfParams.salt" must be base64 of at least ${SALT_BYTES} bytes`)
      }
      const ciphertext = str(key.ciphertext, 'key.ciphertext')
      return {
        version: FILE_VERSION,
        address,
        key: { type, kdf: 'scrypt', kdfParams: { N, r: SCRYPT_R, p: SCRYPT_P, salt }, ciphertext },
      }
    }
    default:
      throw new KeystoreError(
        'UNSUPPORTED_STORAGE',
        `Account file ${path} uses the storage type "${type}", which this reader does not support.`,
      )
  }
}

/**
 * Renders an account file to its exact bytes.
 *
 * Fields appear in the fixed order of the format, with two-space indentation,
 * LF line endings and one trailing newline, so every writer of the format
 * produces the same bytes for the same account.
 *
 * @param file Account content.
 * @returns The file content as UTF-8 text.
 */
export function serializeAccountFile(file: AccountFile): string {
  const { key } = file
  let entry: KeyEntry
  // Each variant is rebuilt field by field so the order never depends on how
  // the caller assembled the object.
  switch (key.type) {
    case 'none':
      entry = { type: 'none' }
      break
    case 'plaintext':
      entry = { type: 'plaintext', privateKey: key.privateKey }
      break
    case 'keychain':
      entry = { type: 'keychain', service: key.service, account: key.account }
      break
    case 'encrypted':
      entry = {
        type: 'encrypted',
        kdf: key.kdf,
        kdfParams: { N: key.kdfParams.N, r: key.kdfParams.r, p: key.kdfParams.p, salt: key.kdfParams.salt },
        ciphertext: key.ciphertext,
      }
      break
  }
  return `${JSON.stringify({ version: file.version, address: file.address, key: entry }, null, 2)}\n`
}

/**
 * Reads and validates an account file.
 *
 * Tightens the file to owner-only access (mode 0600) when it is wider, except
 * on Windows, where file modes are not enforced.
 *
 * @param path Account file path.
 * @returns The validated content and the raw bytes, or `undefined` when no file
 *   exists at the path.
 * @throws KeystoreError when the file breaks the format. File system errors
 *   other than a missing file propagate unchanged.
 */
export async function readAccountFile(path: string): Promise<{ file: AccountFile; bytes: Buffer } | undefined> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch (cause) {
    if ((cause as { code?: string } | undefined)?.code === 'ENOENT') return undefined
    throw cause
  }
  let bytes: Buffer
  try {
    if (runtime.platform !== 'win32') {
      const { mode } = await handle.stat()
      // Best effort: a file the user cannot re-mode is still readable.
      if ((mode & 0o777 & ~0o600) !== 0) await handle.chmod(0o600).catch(() => undefined)
    }
    bytes = await handle.readFile()
  } finally {
    await handle.close()
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new KeystoreError('INVALID_ACCOUNT_FILE', `Account file ${path} is not valid: it is not UTF-8 text.`)
  }
  return { file: parseAccountFile(text, path), bytes }
}

/**
 * Replaces a file's content through a temporary file and a rename.
 *
 * The temporary file is created in the same directory with mode 0600 before
 * any content is written, so the content is never readable by other users and
 * a reader never sees a partial file.
 *
 * @param path Destination path. Its directory MUST exist.
 * @param data Complete new content.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.${randomBytes(8).toString('hex')}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (cause) {
    await unlink(temporary).catch(() => undefined)
    throw cause
  }
}

/**
 * Creates a file that must not exist yet, through a temporary file and a hard
 * link.
 *
 * A rename replaces whatever is at the destination; a hard link fails when a
 * file is already there. Two callers creating the same path at the same moment
 * therefore cannot both succeed, and neither can replace the other's file. The
 * temporary file is created in the same directory with mode 0600 before any
 * content is written, so a reader never sees a partial file. On a file system
 * without hard links the destination is created directly, still refusing an
 * existing file.
 *
 * @param path Destination path. Its directory MUST exist.
 * @param data Complete content.
 * @throws The file system error with `code` equal to `'EEXIST'` when a file
 *   already exists at the path. Other file system errors propagate unchanged.
 */
export async function writeFileExclusive(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.${randomBytes(8).toString('hex')}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, path)
    } catch (cause) {
      if ((cause as { code?: string } | undefined)?.code === 'EEXIST') throw cause
      // No hard links here: create the destination itself, exclusively.
      const target = await open(path, 'wx', 0o600)
      try {
        await target.writeFile(data)
        await target.sync()
      } finally {
        await target.close()
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

/**
 * Writes an account file, creating the accounts directory when needed.
 *
 * A directory created here gets mode 0700; missing parents get the default
 * mode, and an existing directory keeps its mode. The file is written with
 * mode 0600. It replaces any file already at the path, unless `exclusive` is
 * set.
 *
 * @param location Resolved account location.
 * @param file Account content.
 * @param exclusive Whether the file must not exist yet. Defaults to false.
 *   Applies when storing a new account, so that two callers storing different
 *   accounts under one name cannot replace each other's file.
 * @throws The file system error with `code` equal to `'EEXIST'` when
 *   `exclusive` is set and a file already exists at the path.
 */
export async function writeAccountFile(location: Location, file: AccountFile, exclusive = false): Promise<void> {
  await mkdir(dirname(location.dir), { recursive: true })
  try {
    await mkdir(location.dir, { mode: 0o700 })
    // mkdir applies the umask; the directory is owner-only regardless of it.
    if (runtime.platform !== 'win32') await chmod(location.dir, 0o700)
  } catch (cause) {
    if ((cause as { code?: string } | undefined)?.code !== 'EEXIST') throw cause
  }
  const text = serializeAccountFile(file)
  if (exclusive) await writeFileExclusive(location.path, text)
  else await writeFileAtomic(location.path, text)
}
