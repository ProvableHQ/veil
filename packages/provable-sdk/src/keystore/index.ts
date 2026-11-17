/**
 * Account keystore: one account file, one lookup order and one set of
 * functions for storing and finding an Aleo account on disk.
 *
 * Node-only. Reads and writes files, reads the environment, runs the macOS
 * `security` tool and may prompt on the terminal.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAccount } from '@provablehq/veil-core'
import { privateKeyToAccount } from '../account.js'
import { encryptKey, parseKey } from './encrypted.js'
import { KeystoreError } from './errors.js'
import {
  STORAGE_TYPES,
  readAccountFile,
  resolveLocation,
  writeAccountFile,
  writeFileAtomic,
  type AccountFile,
  type KeyEntry,
  type Location,
} from './file.js'
import {
  KEY_SERVICE,
  PASSWORD_SERVICE,
  deleteKeychain,
  keychainAvailable,
  readKeychain,
  requireKeychain,
  writeKeychain,
} from './keychain.js'
import { chooseNewPassword, passwordEntryAccount, passwordToKeychainValue, unlock } from './password.js'

export { KeystoreError } from './errors.js'

/**
 * Names how an account file holds the private key.
 *
 * - `'none'`: the file records the address only. The key comes from the
 *   environment on every run, and the file confirms it is the expected account.
 * - `'plaintext'`: the key is in the file, which only its owner can read. The
 *   default.
 * - `'keychain'`: the key is a generic password in the macOS login keychain and
 *   nothing secret is on disk. macOS only.
 * - `'encrypted'`: the key is encrypted in the file under a password.
 */
export type AccountStorage = 'none' | 'plaintext' | 'keychain' | 'encrypted'

/**
 * Names where {@link loadAccount} found the private key.
 *
 * - `'argument'`: the `privateKey` option.
 * - `'env'`: `ALEO_PRIVATE_KEY` or its alias `SHIELD_SWAP_PRIVATE_KEY`.
 * - `'env-file'`: the file named by `ALEO_PRIVATE_KEY_FILE` or its alias
 *   `SHIELD_SWAP_PRIVATE_KEY_FILE`.
 * - `'account-file'`: the selected account file.
 * - `'legacy'`: the `legacyKey` option.
 */
export type KeySource = 'argument' | 'env' | 'env-file' | 'account-file' | 'legacy'

/**
 * Selects an account file.
 *
 * @property name Account name, matching `^[a-z0-9][a-z0-9_-]{0,63}$`. Defaults
 *   to `ALEO_ACCOUNT`, then `default`. Named accounts keep, for example, a
 *   testnet and a mainnet key apart.
 * @property dir Accounts directory; a leading `~` expands to the home
 *   directory. Defaults to `ALEO_ACCOUNTS_DIR`, then `~/.aleo/accounts`. Pass
 *   it to keep accounts inside a project or a test directory.
 */
export interface AccountLocation {
  name?: string
  dir?: string
}

/**
 * Describes an account file without its key.
 *
 * @property name Account name.
 * @property path Absolute path of the account file.
 * @property address Aleo address recorded in the file.
 * @property storage How the file holds the private key.
 */
export interface StoredAccount {
  name: string
  path: string
  address: string
  storage: AccountStorage
}

/**
 * The result of resolving an account through the lookup order.
 *
 * @property account Signing account for the resolved key.
 * @property source Where the key came from.
 * @property stored The selected account file, when one exists. Present even
 *   when the key itself came from the environment.
 */
export interface LoadedAccount {
  account: LocalAccount<'privateKey'>
  source: KeySource
  stored?: StoredAccount
}

/** Variables holding a private key, in order of precedence. */
const KEY_VARIABLES = ['ALEO_PRIVATE_KEY', 'SHIELD_SWAP_PRIVATE_KEY'] as const

/** Variables naming a text file that holds only a private key, in order of precedence. */
const KEY_FILE_VARIABLES = ['ALEO_PRIVATE_KEY_FILE', 'SHIELD_SWAP_PRIVATE_KEY_FILE'] as const

/** Top-level fields a legacy state file may keep its key in, in order of precedence. */
const LEGACY_KEY_FIELDS = ['privateKey', 'private_key'] as const

/** Builds the public description of an account file. */
function describe(location: Location, file: AccountFile): StoredAccount {
  return { name: location.name, path: location.path, address: file.address, storage: file.key.type }
}

/**
 * Checks a storage value supplied at run time.
 *
 * @param storage Value of a `storage` option.
 * @param allowed Storage types the calling function accepts.
 * @throws KeystoreError `UNSUPPORTED_STORAGE` for any other value.
 */
function assertStorage<T extends AccountStorage>(storage: unknown, allowed: readonly T[]): asserts storage is T {
  if (!allowed.includes(storage as T)) {
    throw new KeystoreError(
      'UNSUPPORTED_STORAGE',
      `Unsupported storage type "${String(storage)}"; expected one of ${allowed.join(', ')}.`,
    )
  }
}

/** Builds the error for a key that derives a different address than required. */
function mismatch(origin: string, actual: string, requirement: string, expected: string): KeystoreError {
  return new KeystoreError('ADDRESS_MISMATCH', `${origin} derives ${actual}, but ${requirement} ${expected}.`)
}

/**
 * Collects the private key supplied through the environment.
 *
 * Reads the two key variables and the files named by the two key-file
 * variables. Every variable that is set must supply a key, and all of them
 * must supply the same one.
 *
 * @returns The key, its address, the kind of source and a phrase naming the
 *   variable, or `undefined` when none of the variables is set.
 * @throws KeystoreError `EMPTY_KEY_SOURCE` when a variable is set but empty or
 *   its file is empty or unreadable, `INVALID_KEY` when a value is not a key,
 *   and `KEY_CONFLICT` when two variables supply different keys.
 */
async function keyFromEnvironment(): Promise<
  { privateKey: string; address: string; source: 'env' | 'env-file'; origin: string } | undefined
> {
  const found: Array<{ privateKey: string; address: string; source: 'env' | 'env-file'; origin: string }> = []

  for (const variable of KEY_VARIABLES) {
    const value = process.env[variable]
    if (value === undefined) continue
    const text = value.trim()
    if (!text) throw new KeystoreError('EMPTY_KEY_SOURCE', `${variable} is set but empty.`)
    found.push({ ...parseKey(text, variable), source: 'env', origin: variable })
  }

  for (const variable of KEY_FILE_VARIABLES) {
    const path = process.env[variable]
    if (path === undefined) continue
    if (!path.trim()) throw new KeystoreError('EMPTY_KEY_SOURCE', `${variable} is set but empty.`)
    const origin = `The key file ${path} named by ${variable}`
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch (cause) {
      const code = (cause as { code?: string } | undefined)?.code ?? 'unknown error'
      throw new KeystoreError('EMPTY_KEY_SOURCE', `${origin} could not be read (${code}).`, { cause })
    }
    const text = content.trim()
    if (!text) throw new KeystoreError('EMPTY_KEY_SOURCE', `${origin} is empty.`)
    found.push({ ...parseKey(text, origin), source: 'env-file', origin })
  }

  // The first entry is the one with the highest precedence. The others only
  // have to agree with it.
  const [first, ...others] = found
  if (!first) return undefined
  for (const other of others) {
    if (other.address !== first.address) {
      throw new KeystoreError(
        'KEY_CONFLICT',
        `${first.origin} and ${other.origin} hold different keys (${first.address} and ${other.address}). ` +
          'Unset one of them.',
      )
    }
  }
  return first
}

/**
 * Reads the private key an account file holds or points at.
 *
 * Does not consult the key variables. May run the `security` tool, stretch a
 * password and prompt on the terminal, depending on the storage type.
 *
 * @param file Validated account file content.
 * @param location Location of the file, named in messages and prompts.
 * @param options.password Password for an encrypted file, as text or as
 *   normalised bytes. Defaults to the other password sources.
 * @param options.prompt Whether a password prompt may be shown. Defaults to
 *   true.
 * @returns The private key, and for an encrypted file the password that
 *   unlocked it.
 * @throws KeystoreError `KEY_NOT_STORED`, `INVALID_KEY`, `ADDRESS_MISMATCH`,
 *   `KEYCHAIN_UNAVAILABLE`, `KEYCHAIN_ITEM_NOT_FOUND`, `KEYCHAIN_FAILED`,
 *   `PASSWORD_REQUIRED` or `WRONG_PASSWORD`.
 */
async function readStoredKey(
  file: AccountFile,
  location: Location,
  options: { password?: string | Buffer; prompt?: boolean },
): Promise<{ privateKey: string; password?: Buffer }> {
  const { key, address } = file
  switch (key.type) {
    case 'none':
      throw new KeystoreError(
        'KEY_NOT_STORED',
        `Account file ${location.path} records the address ${address} without a key; ` +
          'the key of this account is supplied through ALEO_PRIVATE_KEY or ALEO_PRIVATE_KEY_FILE.',
      )
    case 'plaintext': {
      const origin = `The key in account file ${location.path}`
      const parsed = parseKey(key.privateKey, origin)
      if (parsed.address !== address) throw mismatch(origin, parsed.address, 'the file records', address)
      return { privateKey: parsed.privateKey }
    }
    case 'keychain': {
      requireKeychain(
        `Account file ${location.path} keeps its key in the Keychain of the Mac it was created on. ` +
          'Export the key on that Mac and import it here.',
      )
      const value = await readKeychain(KEY_SERVICE, address)
      if (value === undefined) {
        throw new KeystoreError(
          'KEYCHAIN_ITEM_NOT_FOUND',
          `Account file ${location.path} points at the Keychain entry ${KEY_SERVICE} for ${address}, which does not exist.`,
        )
      }
      const origin = `The Keychain entry ${KEY_SERVICE} for ${address}`
      const parsed = parseKey(value, origin)
      if (parsed.address !== address) throw mismatch(origin, parsed.address, `account file ${location.path} records`, address)
      return { privateKey: parsed.privateKey }
    }
    case 'encrypted':
      return unlock({ name: location.name, address }, key, options)
  }
}

/**
 * Identifies one Keychain entry.
 *
 * @property service Keychain service name.
 * @property account The entry's account within the service.
 */
type KeychainEntry = { service: string; account: string }

/** Removes Keychain entries, ignoring failures; used when undoing a failed step. */
async function removeEntries(entries: readonly KeychainEntry[]): Promise<void> {
  for (const entry of entries) await deleteKeychain(entry.service, entry.account).catch(() => undefined)
}

/**
 * Reports whether another account file in the same directory matches.
 *
 * Keychain entries can be shared: every account file that holds one key in
 * the Keychain points at the same entry, and a copied encrypted file shares
 * its saved password. Before an entry is removed, the neighbouring files are
 * checked so that one still in use stays. Files that cannot be read or parsed
 * are skipped. Account files in other directories are not seen.
 *
 * @param location The account file being changed; it is not counted itself.
 * @param matches Decides whether a parsed neighbouring file uses the entry.
 * @returns True when a neighbouring account file matches.
 */
async function neighbourUses(location: Location, matches: (file: Record<string, unknown>) => boolean): Promise<boolean> {
  let names: string[]
  try {
    names = await readdir(location.dir)
  } catch {
    return false
  }
  for (const name of names) {
    if (!name.endsWith('.json') || name === `${location.name}.json`) continue
    try {
      const parsed: unknown = JSON.parse(await readFile(join(location.dir, name), 'utf8'))
      if (typeof parsed === 'object' && parsed !== null && matches(parsed as Record<string, unknown>)) return true
    } catch {
      // Not an account file, or not readable: it holds no claim on the entry.
    }
  }
  return false
}

/** Reads the `key` object of a loosely parsed account file. */
function keyOf(file: Record<string, unknown>): Record<string, unknown> {
  const key = file.key
  return typeof key === 'object' && key !== null ? (key as Record<string, unknown>) : {}
}

/**
 * Writes an account under the given storage.
 *
 * Secrets held outside the file (the Keychain key entry, a saved password) are
 * written first, so a failure there leaves no file pointing at a missing entry.
 *
 * @param location Resolved account location.
 * @param account Parsed key and the address it derives.
 * @param storage Storage type to write.
 * @param password Normalised password bytes; required for `'encrypted'`.
 * @param savePassword Whether to save the password in the macOS Keychain.
 *   Applies to `'encrypted'` on macOS and is ignored otherwise.
 * @param options.exclusive Whether the account file must not exist yet.
 *   Defaults to false, which replaces any file at the path.
 * @param options.created Receives each Keychain entry this call creates, so a
 *   caller can remove them when a later step fails. An entry that existed
 *   before the call is not listed: another account file may rely on it.
 * @returns The content written to the account file.
 * @throws The file system error with `code` equal to `'EEXIST'` when
 *   `exclusive` is set and the account file already exists.
 */
async function writeStorage(
  location: Location,
  account: { privateKey: string; address: string },
  storage: AccountStorage,
  password: Buffer | undefined,
  savePassword: boolean,
  options: { exclusive?: boolean; created?: KeychainEntry[] } = {},
): Promise<AccountFile> {
  const { privateKey, address } = account
  let key: KeyEntry
  switch (storage) {
    case 'none':
      key = { type: 'none' }
      break
    case 'plaintext':
      key = { type: 'plaintext', privateKey }
      break
    case 'keychain':
      if (await writeKeychain(KEY_SERVICE, address, privateKey, location.name)) {
        options.created?.push({ service: KEY_SERVICE, account: address })
      }
      key = { type: 'keychain', service: KEY_SERVICE, account: address }
      break
    case 'encrypted': {
      if (!password) throw new KeystoreError('PASSWORD_REQUIRED', `Encrypting the account ${address} needs a password.`)
      key = await encryptKey(privateKey, password)
      if (savePassword && keychainAvailable()) {
        // The entry is named after this file's salt, so it cannot collide
        // with the saved password of another file for the same address.
        const entry = passwordEntryAccount(address, key.kdfParams.salt)
        if (await writeKeychain(PASSWORD_SERVICE, entry, passwordToKeychainValue(password), location.name)) {
          options.created?.push({ service: PASSWORD_SERVICE, account: entry })
        }
      }
      break
    }
  }
  const file: AccountFile = { version: 1, address, key }
  await writeAccountFile(location, file, options.exclusive === true)
  return file
}

/**
 * Reads an account file back and confirms it returns the expected key.
 *
 * @param location Resolved account location.
 * @param account Key the file must return and the address it derives.
 * @param storage Storage type the file must have.
 * @param password Password for an encrypted file, as text or normalised bytes.
 *   Defaults to the other password sources.
 * @param prompt Whether a password prompt may be shown.
 * @throws KeystoreError `INVALID_ACCOUNT_FILE` when the file is absent or holds
 *   another account or storage, `ADDRESS_MISMATCH` when it returns another
 *   key, plus the failures of reading the stored key.
 */
async function confirmStored(
  location: Location,
  account: { privateKey: string; address: string },
  storage: AccountStorage,
  password: string | Buffer | undefined,
  prompt: boolean,
): Promise<void> {
  const written = await readAccountFile(location.path)
  if (!written || written.file.address !== account.address || written.file.key.type !== storage) {
    throw new KeystoreError(
      'INVALID_ACCOUNT_FILE',
      `Account file ${location.path} does not hold ${account.address} with ${storage} storage.`,
    )
  }
  const { privateKey } = await readStoredKey(written.file, location, { password, prompt })
  if (privateKey !== account.privateKey) {
    throw new KeystoreError(
      'ADDRESS_MISMATCH',
      `Account file ${location.path} does not return the key of ${account.address} when read back.`,
    )
  }
}

/**
 * Stores an account unless its file already exists.
 *
 * Shared by {@link saveAccount} and {@link migrateAccount}.
 *
 * @param account Parsed key and the address it derives.
 * @param location Resolved account location.
 * @param options.storage Storage type to write.
 * @param options.password Password for `'encrypted'`. Defaults to
 *   `ALEO_ACCOUNT_PASSWORD`, then a prompt that asks twice.
 * @param options.savePassword Whether to save the password in the Keychain.
 * @returns The stored account and, when a new encrypted file was written, the
 *   password it was written with.
 * @throws KeystoreError `ACCOUNT_EXISTS` when the file exists with another
 *   address or another storage type, plus the failures of writing the storage.
 */
async function storeAccount(
  account: { privateKey: string; address: string },
  location: Location,
  options: { storage: AccountStorage; password?: string; savePassword?: boolean },
): Promise<{ stored: StoredAccount; password?: Buffer }> {
  const { storage } = options
  // Checked before anything is written or asked for.
  if (storage === 'keychain') {
    requireKeychain('Keychain storage works on macOS only; use "plaintext" or "encrypted" here.')
  }

  const existing = await readAccountFile(location.path)
  if (existing) {
    if (existing.file.address !== account.address) {
      throw new KeystoreError(
        'ACCOUNT_EXISTS',
        `Account file ${location.path} already holds ${existing.file.address}; refusing to replace it with ${account.address}. ` +
          'Choose another account name.',
      )
    }
    if (existing.file.key.type !== storage) {
      throw new KeystoreError(
        'ACCOUNT_EXISTS',
        `Account file ${location.path} already holds ${account.address} with ${existing.file.key.type} storage. ` +
          'Use protectAccount to change how the key is stored.',
      )
    }
    // Same account, same storage: nothing to write.
    return { stored: describe(location, existing.file) }
  }

  let password: Buffer | undefined
  if (storage === 'encrypted') {
    password = await chooseNewPassword(
      { name: location.name, address: account.address },
      { explicit: [options.password], environment: true, prompt: true },
    )
  }
  // The file is created exclusively: another process may have stored an
  // account under this name since the check above, and it MUST NOT be replaced.
  // Only Keychain entries this call creates are undone on failure: an entry
  // that was already there may be the only stored key of another account file.
  const created: KeychainEntry[] = []
  try {
    const file = await writeStorage(location, account, storage, password, options.savePassword === true, {
      exclusive: true,
      created,
    })
    return { stored: describe(location, file), password }
  } catch (error) {
    if ((error as { code?: string } | undefined)?.code === 'EEXIST') {
      const now = await readAccountFile(location.path)
      // The same account in the same Keychain storage is what was asked for,
      // and the key entry just written is the one that file points at.
      if (now && now.file.address === account.address && now.file.key.type === storage && storage !== 'encrypted') {
        return { stored: describe(location, now.file) }
      }
      await removeEntries(created)
      if (now && now.file.address === account.address && now.file.key.type === storage) {
        return { stored: describe(location, now.file) }
      }
      throw new KeystoreError(
        'ACCOUNT_EXISTS',
        `Account file ${location.path} was created by another process while ${account.address} was being stored; ` +
          'it was not replaced. Choose another account name.',
      )
    }
    // No account file was created, so nothing points at the entries made here.
    await removeEntries(created)
    throw error
  }
}

/**
 * Stores an account in an account file.
 *
 * Writes `<dir>/<name>.json` with owner-only access (directory mode 0700, file
 * mode 0600) through a temporary file and a rename. Depending on `storage` it
 * also writes the macOS Keychain or stretches a password, and it prompts for a
 * password when `'encrypted'` is requested without one and a terminal is
 * attached. Does not contact a network.
 *
 * Creating a key and storing it are separate steps: pass an account from
 * `generateAccount()`, `privateKeyToAccount()` or `mnemonicToAccount()`.
 * An existing file is never replaced. The same account with the same storage
 * returns without rewriting.
 *
 * @param account Address and private key to store. The key MUST derive the
 *   address.
 * @param options.name Account name. Defaults to `ALEO_ACCOUNT`, then `default`.
 * @param options.dir Accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`, then
 *   `~/.aleo/accounts`.
 * @param options.storage How to hold the key. Defaults to `'plaintext'`. Use
 *   `'keychain'` (macOS) or `'encrypted'` to protect a copied or backed-up
 *   file, and `'none'` to record the address only.
 * @param options.password Password for `'encrypted'`. Defaults to
 *   `ALEO_ACCOUNT_PASSWORD`, then a hidden prompt that asks twice. MUST NOT be
 *   empty.
 * @param options.savePassword Also save the password in the macOS Keychain, so
 *   later loads need no password. Defaults to false. Applies to `'encrypted'`
 *   on macOS and is ignored otherwise.
 * @returns The stored account, without its key.
 * @throws KeystoreError `ACCOUNT_EXISTS` when the file holds another address,
 *   or the same address with another storage (use {@link protectAccount});
 *   `INVALID_KEY` or `ADDRESS_MISMATCH` when the key is unusable or does not
 *   derive the address; `INVALID_NAME`; `UNSUPPORTED_STORAGE`;
 *   `KEYCHAIN_UNAVAILABLE` for `'keychain'` outside macOS, before anything is
 *   written; `KEYCHAIN_FAILED`; `PASSWORD_REQUIRED` when `'encrypted'` has no
 *   password source.
 *
 * @example
 * import { generateAccount } from '@provablehq/veil-aleo-sdk'
 * import { saveAccount } from '@provablehq/veil-aleo-sdk/node'
 *
 * const stored = await saveAccount(generateAccount(), { name: 'testnet' })
 * stored.path // '/home/alice/.aleo/accounts/testnet.json'
 */
export async function saveAccount(
  account: { address: string; privateKey: string },
  options: AccountLocation & { storage?: AccountStorage; password?: string; savePassword?: boolean } = {},
): Promise<StoredAccount> {
  const storage = options.storage ?? 'plaintext'
  assertStorage(storage, STORAGE_TYPES)
  const location = resolveLocation(options)
  const parsed = parseKey(account.privateKey, 'The private key of the account')
  if (parsed.address !== account.address) {
    throw mismatch('The private key of the account', parsed.address, 'the account states', String(account.address))
  }
  const { stored } = await storeAccount(parsed, location, {
    storage,
    password: options.password,
    savePassword: options.savePassword,
  })
  return stored
}

/**
 * Resolves the account to sign with, following the lookup order.
 *
 * Sources, first match wins:
 *
 * 1. The `privateKey` option. The key variables are then not read.
 * 2. `ALEO_PRIVATE_KEY`, then its alias `SHIELD_SWAP_PRIVATE_KEY`.
 * 3. The file named by `ALEO_PRIVATE_KEY_FILE`, then its alias
 *    `SHIELD_SWAP_PRIVATE_KEY_FILE`: a text file holding only the key.
 * 4. The selected account file.
 * 5. The `legacyKey` option, only when no account file exists.
 *
 * A variable that is set but empty is an error, and so are two variables that
 * hold different keys. When the selected account file exists, a key from
 * sources 1 to 3 must derive the address the file records. Nothing here
 * generates a key or writes one to disk.
 *
 * Reads the environment and the account file, tightens a file readable by
 * others to mode 0600, and for a `'keychain'` or `'encrypted'` file runs the
 * macOS `security` tool or stretches a password (about 200 ms). The password
 * of an encrypted file comes from the `password` option, then
 * `ALEO_ACCOUNT_PASSWORD`, then a password saved in the macOS Keychain, then a
 * hidden terminal prompt with three attempts. Does not contact a network.
 *
 * @param options.name Account name. Defaults to `ALEO_ACCOUNT`, then `default`.
 * @param options.dir Accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`, then
 *   `~/.aleo/accounts`.
 * @param options.privateKey Key supplied by the caller, taking precedence over
 *   every other source.
 * @param options.legacyKey Key from the calling tool's own earlier state. Used
 *   only when no other source and no account file exists; the result then
 *   reports `source: 'legacy'`. When an account file exists, this key MUST
 *   derive the file's address.
 * @param options.expectedAddress Address the resolved key MUST derive, such as
 *   the address recorded in the calling tool's state.
 * @param options.password Password for an encrypted account file.
 * @param options.prompt Whether a password prompt may be shown when a terminal
 *   is attached. Defaults to true. Pass false for unattended jobs.
 * @returns The signing account, the source of its key and the selected account
 *   file when one exists.
 * @throws KeystoreError `ACCOUNT_NOT_FOUND` when no source produced a key;
 *   `KEY_NOT_STORED` when the file records an address only and no key came
 *   from sources 1 to 3; `EMPTY_KEY_SOURCE`; `KEY_CONFLICT`; `INVALID_KEY`;
 *   `ADDRESS_MISMATCH`; `INVALID_NAME`; `INVALID_ACCOUNT_FILE`,
 *   `UNSUPPORTED_VERSION` or `UNSUPPORTED_STORAGE` for a file this reader
 *   cannot use; `KEYCHAIN_UNAVAILABLE`, `KEYCHAIN_ITEM_NOT_FOUND` or
 *   `KEYCHAIN_FAILED`; `PASSWORD_REQUIRED` or `WRONG_PASSWORD`.
 *
 * @example
 * import { loadNetwork } from '@provablehq/veil-aleo-sdk'
 * import { loadAccount } from '@provablehq/veil-aleo-sdk/node'
 *
 * const { account, source } = await loadAccount()
 * const aleo = await loadNetwork('testnet')
 * const { walletClient } = aleo.createAleoClient({ privateKey: account.privateKey })
 */
export async function loadAccount(
  options: AccountLocation & {
    privateKey?: string
    legacyKey?: string
    expectedAddress?: string
    password?: string
    prompt?: boolean
  } = {},
): Promise<LoadedAccount> {
  const location = resolveLocation(options)

  // Sources 1 to 3: a key handed over by the caller or the environment.
  let resolved: { privateKey: string; address: string; source: KeySource; origin: string } | undefined
  if (options.privateKey !== undefined) {
    const origin = 'The privateKey option'
    resolved = { ...parseKey(options.privateKey, origin), source: 'argument', origin }
  } else {
    resolved = await keyFromEnvironment()
  }

  // The account file is read even when a key is already in hand: it records
  // which account this name stands for, and an unusable file stops the lookup.
  const existing = await readAccountFile(location.path)
  const legacyOrigin = 'The legacyKey option'
  if (existing && options.legacyKey !== undefined) {
    const legacy = parseKey(options.legacyKey, legacyOrigin)
    if (legacy.address !== existing.file.address) {
      throw mismatch(legacyOrigin, legacy.address, `account file ${location.path} records`, existing.file.address)
    }
  }

  if (resolved) {
    if (existing && resolved.address !== existing.file.address) {
      throw mismatch(resolved.origin, resolved.address, `account file ${location.path} records`, existing.file.address)
    }
  } else if (existing) {
    // Source 4: the account file itself.
    const origin = `Account file ${location.path}`
    const { privateKey } = await readStoredKey(existing.file, location, {
      password: options.password,
      prompt: options.prompt,
    })
    resolved = { privateKey, address: existing.file.address, source: 'account-file', origin }
  } else if (options.legacyKey !== undefined) {
    // Source 5: the calling tool's earlier state.
    resolved = { ...parseKey(options.legacyKey, legacyOrigin), source: 'legacy', origin: legacyOrigin }
  } else {
    throw new KeystoreError(
      'ACCOUNT_NOT_FOUND',
      `No Aleo account found: ${KEY_VARIABLES[0]} and ${KEY_FILE_VARIABLES[0]} are not set and ` +
        `there is no account file at ${location.path}.`,
    )
  }

  if (options.expectedAddress !== undefined && resolved.address !== options.expectedAddress) {
    throw mismatch(resolved.origin, resolved.address, 'the expected address is', options.expectedAddress)
  }

  const loaded: LoadedAccount = { account: privateKeyToAccount(resolved.privateKey), source: resolved.source }
  if (existing) loaded.stored = describe(location, existing.file)
  return loaded
}

/**
 * Describes the selected account file without reading its key.
 *
 * Reads only the account file: no key variable, Keychain entry or password is
 * touched, so it is safe to show the result. Tightens a file readable by
 * others to mode 0600.
 *
 * @param options.name Account name. Defaults to `ALEO_ACCOUNT`, then `default`.
 * @param options.dir Accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`, then
 *   `~/.aleo/accounts`.
 * @returns The account's name, path, address and storage type, or `undefined`
 *   when no account file exists.
 * @throws KeystoreError `INVALID_NAME`, or `INVALID_ACCOUNT_FILE`,
 *   `UNSUPPORTED_VERSION` or `UNSUPPORTED_STORAGE` for a file this reader
 *   cannot use.
 *
 * @example
 * import { accountInfo } from '@provablehq/veil-aleo-sdk/node'
 *
 * const stored = await accountInfo({ name: 'testnet' })
 * if (stored) console.log(`${stored.address} (${stored.storage})`)
 */
export async function accountInfo(options: AccountLocation = {}): Promise<StoredAccount | undefined> {
  const location = resolveLocation(options)
  const existing = await readAccountFile(location.path)
  return existing ? describe(location, existing.file) : undefined
}

/**
 * Changes how an existing account file holds its key.
 *
 * Reads the current key from the account file, writes the new storage, reads
 * it back and checks the address, and only then removes the old secret: the
 * Keychain key entry, or a saved password that no longer applies. When the
 * check fails the original file is put back. The key variables are not read.
 *
 * Requesting `'encrypted'` for an account that is already encrypted sets a new
 * password and a new salt. Requesting the storage a plaintext or Keychain
 * account already has returns without rewriting. An account cannot be moved to
 * `'none'`, which would delete the only stored copy of the key.
 *
 * @param options.storage Storage to move to.
 * @param options.name Account name. Defaults to `ALEO_ACCOUNT`, then `default`.
 * @param options.dir Accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`, then
 *   `~/.aleo/accounts`.
 * @param options.password Current password when the account is encrypted;
 *   defaults to `ALEO_ACCOUNT_PASSWORD`, a password saved in the Keychain, then
 *   a prompt. When the account is not yet encrypted and `newPassword` is not
 *   given, this is the password to set.
 * @param options.newPassword Password to encrypt with. When the account is not
 *   yet encrypted it defaults to `password`, then `ALEO_ACCOUNT_PASSWORD`, then
 *   a prompt that asks twice. When replacing an existing password it defaults
 *   to the prompt only.
 * @param options.savePassword Save the new password in the macOS Keychain.
 *   Defaults to false, which also removes a previously saved password. Applies
 *   to `'encrypted'` on macOS and is ignored otherwise.
 * @param options.prompt Whether password prompts may be shown when a terminal
 *   is attached. Defaults to true.
 * @returns The account as stored after the change.
 * @throws KeystoreError `ACCOUNT_NOT_FOUND` when no account file exists;
 *   `KEY_NOT_STORED` when the file records an address only;
 *   `UNSUPPORTED_STORAGE` for `'none'` or an unknown storage;
 *   `KEYCHAIN_UNAVAILABLE` outside macOS, before anything is written;
 *   `KEYCHAIN_ITEM_NOT_FOUND` or `KEYCHAIN_FAILED`; `PASSWORD_REQUIRED` or
 *   `WRONG_PASSWORD`; `ADDRESS_MISMATCH` when a stored key does not derive the
 *   file's address.
 *
 * @example
 * import { protectAccount } from '@provablehq/veil-aleo-sdk/node'
 *
 * // Move a plaintext account into the macOS Keychain.
 * const stored = await protectAccount({ name: 'mainnet', storage: 'keychain' })
 */
export async function protectAccount(
  options: AccountLocation & {
    storage: 'plaintext' | 'keychain' | 'encrypted'
    password?: string
    newPassword?: string
    savePassword?: boolean
    prompt?: boolean
  },
): Promise<StoredAccount> {
  const { storage } = options
  assertStorage(storage, ['plaintext', 'keychain', 'encrypted'] as const)
  const location = resolveLocation(options)
  if (storage === 'keychain') {
    requireKeychain('Keychain storage works on macOS only; use "plaintext" or "encrypted" here.')
  }

  const existing = await readAccountFile(location.path)
  if (!existing) {
    throw new KeystoreError('ACCOUNT_NOT_FOUND', `There is no account file at ${location.path}.`)
  }
  const current = existing.file.key.type
  const address = existing.file.address
  const subject = { name: location.name, address }

  // A plaintext or Keychain account already stored as requested needs nothing.
  if (current === storage && storage !== 'encrypted') return describe(location, existing.file)

  // Reading the current key also proves the stored copy is intact before
  // anything is replaced. An address-only file fails here with KEY_NOT_STORED.
  const { privateKey } = await readStoredKey(existing.file, location, {
    password: options.password,
    prompt: options.prompt,
  })

  let password: Buffer | undefined
  if (storage === 'encrypted') {
    const prompt = options.prompt !== false
    password =
      current === 'encrypted'
        ? // The variable and `password` hold the current password here, so the
          // new one comes from its own option or the person at the terminal.
          await chooseNewPassword(subject, { explicit: [options.newPassword], environment: false, prompt })
        : await chooseNewPassword(subject, {
            explicit: [options.newPassword, options.password],
            environment: true,
            prompt,
          })
  }
  const savePassword = storage === 'encrypted' && options.savePassword === true && keychainAvailable()

  // Every step below is undone together if any of them fails: the original
  // file goes back, and the Keychain entries this call created are removed.
  // The old secret is the last thing touched, and it is touched only once
  // everything else has succeeded, so the original file works again as soon
  // as it is back in place.
  const created: KeychainEntry[] = []
  try {
    // The new file's saved password has its own entry, named after the new
    // salt, so the entry of the file being replaced is not disturbed.
    await writeStorage(location, { privateKey, address }, storage, password, savePassword, { created })
    // Read the new storage back the way a later load would, then compare.
    await confirmStored(location, { privateKey, address }, storage, password, false)

    // Only now is the old secret redundant. An entry a neighbouring account
    // file still uses is left in place.
    const previous = existing.file.key
    if (previous.type === 'keychain' && storage !== 'keychain') {
      const shared = await neighbourUses(location, (file) => file.address === address && keyOf(file).type === 'keychain')
      if (!shared) await deleteKeychain(KEY_SERVICE, address)
    }
    if (previous.type === 'encrypted' && keychainAvailable()) {
      const salt = previous.kdfParams.salt
      const shared = await neighbourUses(location, (file) => {
        const key = keyOf(file)
        const params = key.kdfParams
        return (
          file.address === address &&
          key.type === 'encrypted' &&
          typeof params === 'object' &&
          params !== null &&
          (params as Record<string, unknown>).salt === salt
        )
      })
      if (!shared) await deleteKeychain(PASSWORD_SERVICE, passwordEntryAccount(address, salt))
    }
  } catch (error) {
    await writeFileAtomic(location.path, existing.bytes)
    await removeEntries(created)
    throw error
  }

  return { name: location.name, path: location.path, address, storage }
}

/**
 * Returns the private key held by the selected account file.
 *
 * Reads only the account file and what it points at (the Keychain entry, or
 * the password sources of an encrypted file); the key variables are never
 * consulted. The result is the secret itself: a caller that prints it is
 * responsible for doing so only for a person at a terminal.
 *
 * @param options.name Account name. Defaults to `ALEO_ACCOUNT`, then `default`.
 * @param options.dir Accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`, then
 *   `~/.aleo/accounts`.
 * @param options.password Password for an encrypted account file. Defaults to
 *   `ALEO_ACCOUNT_PASSWORD`, a password saved in the Keychain, then a prompt.
 * @param options.prompt Whether a password prompt may be shown when a terminal
 *   is attached. Defaults to true.
 * @returns The private key (`APrivateKey1...`).
 * @throws KeystoreError `ACCOUNT_NOT_FOUND` when no account file exists;
 *   `KEY_NOT_STORED` when the file records an address only; `INVALID_KEY` or
 *   `ADDRESS_MISMATCH` when the stored key is unusable; `KEYCHAIN_UNAVAILABLE`,
 *   `KEYCHAIN_ITEM_NOT_FOUND` or `KEYCHAIN_FAILED`; `PASSWORD_REQUIRED` or
 *   `WRONG_PASSWORD`.
 *
 * @example
 * import { exportAccount } from '@provablehq/veil-aleo-sdk/node'
 *
 * const privateKey = await exportAccount({ name: 'testnet' })
 */
export async function exportAccount(
  options: AccountLocation & { password?: string; prompt?: boolean } = {},
): Promise<string> {
  const location = resolveLocation(options)
  const existing = await readAccountFile(location.path)
  if (!existing) {
    throw new KeystoreError('ACCOUNT_NOT_FOUND', `There is no account file at ${location.path}.`)
  }
  const { privateKey } = await readStoredKey(existing.file, location, {
    password: options.password,
    prompt: options.prompt,
  })
  return privateKey
}

/**
 * Reads the private key from a legacy state file.
 *
 * @param path Path of a JSON file with a top-level `privateKey` or
 *   `private_key` string.
 * @returns The file's text and parsed content, every field that holds the key
 *   and the parsed key.
 * @throws KeystoreError `LEGACY_KEY_NOT_FOUND` when the file cannot be read, is
 *   not a JSON object or has neither field; `INVALID_KEY` when a field holds
 *   text that is not a key; `KEY_CONFLICT` when the two fields hold different
 *   keys, since it is then unclear which account the file belongs to.
 */
async function readLegacyKey(path: string): Promise<{
  text: string
  content: Record<string, unknown>
  fields: Array<(typeof LEGACY_KEY_FIELDS)[number]>
  account: { privateKey: string; address: string }
}> {
  const notFound = (problem: string, cause?: unknown) =>
    new KeystoreError('LEGACY_KEY_NOT_FOUND', `No key found in ${path}: ${problem}.`, cause ? { cause } : undefined)

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (cause) {
    const code = (cause as { code?: string } | undefined)?.code ?? 'unknown error'
    throw notFound(`the file could not be read (${code})`, cause)
  }
  let content: unknown
  try {
    content = JSON.parse(text)
  } catch {
    // The parser's message can quote the file, which holds a key.
    throw notFound('the file is not JSON')
  }
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    throw notFound('the file does not hold a JSON object')
  }
  const record = content as Record<string, unknown>
  const fields = LEGACY_KEY_FIELDS.filter((name) => typeof record[name] === 'string' && record[name] !== '')
  const [first, second] = fields
  if (!first) throw notFound('it has no "privateKey" or "private_key" field')
  const account = parseKey(record[first], `The "${first}" field of ${path}`)
  if (second) {
    const other = parseKey(record[second], `The "${second}" field of ${path}`)
    if (other.address !== account.address) {
      throw new KeystoreError(
        'KEY_CONFLICT',
        `${path} holds two different keys: "${first}" belongs to ${account.address} and "${second}" to ${other.address}. ` +
          'Remove the one that is not wanted, then migrate again.',
      )
    }
  }
  return { text, content: record, fields, account }
}

/**
 * Renders a legacy state file without its key fields.
 *
 * Keeps the other fields in their order, the indentation of the original and
 * whether it ended with a newline.
 *
 * @param text Original file text.
 * @param content Parsed original content.
 * @param fields Fields to leave out.
 * @returns The new file text.
 */
function withoutKeyFields(text: string, content: Record<string, unknown>, fields: readonly string[]): string {
  const rest = { ...content }
  for (const field of fields) delete rest[field]
  // The indentation is whatever precedes the first field on its own line; a
  // file written on one line stays on one line.
  const indent = /^\s*\{\r?\n([ \t]+)\S/.exec(text)?.[1]
  const body = indent === undefined ? JSON.stringify(rest) : JSON.stringify(rest, null, indent)
  return text.endsWith('\n') ? `${body}\n` : body
}

/**
 * Copies the private key from a legacy state file into an account file.
 *
 * Reads a JSON file that keeps a key in a top-level `privateKey` or
 * `private_key` field, such as a Shield Swap CLI `state.json` or a Python SDK
 * `profile.json`, and stores that key exactly as {@link saveAccount} would.
 * The legacy file is left untouched unless `removeLegacyKey` is set, so by
 * default a plaintext copy of the key remains there.
 *
 * With `removeLegacyKey`, the new account is read back and its address
 * confirmed first; the legacy file is then rewritten without the key field,
 * keeping its other fields, their order and its indentation, at mode 0600.
 *
 * A file that holds the same key in both fields is migrated, and both fields
 * are removed. A file whose two fields hold different keys is refused with
 * `KEY_CONFLICT`, since it is unclear which account it belongs to.
 *
 * @param options.from Path of the legacy JSON file.
 * @param options.name Account name. Defaults to `ALEO_ACCOUNT`, then `default`.
 * @param options.dir Accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`, then
 *   `~/.aleo/accounts`.
 * @param options.storage How to hold the key. Defaults to `'plaintext'`.
 * @param options.password Password for `'encrypted'`. Defaults to
 *   `ALEO_ACCOUNT_PASSWORD`, then a hidden prompt that asks twice.
 * @param options.savePassword Also save the password in the macOS Keychain.
 *   Defaults to false. Applies to `'encrypted'` on macOS.
 * @param options.removeLegacyKey Strip the key from the legacy file once the
 *   new account file is confirmed. Defaults to false. Not allowed with
 *   `storage: 'none'`, which would leave no stored copy.
 * @returns The stored account, and `legacyKeyRemoved` stating whether the key
 *   field was stripped from the legacy file.
 * @throws KeystoreError `LEGACY_KEY_NOT_FOUND` when the file holds no key;
 *   `INVALID_KEY`; `KEY_NOT_STORED` when `removeLegacyKey` is combined with
 *   `'none'`; plus every failure of {@link saveAccount}, including
 *   `ACCOUNT_EXISTS`.
 *
 * @example
 * import { migrateAccount } from '@provablehq/veil-aleo-sdk/node'
 *
 * const { address, legacyKeyRemoved } = await migrateAccount({
 *   from: './.shield-swap/testnet/state.json',
 *   removeLegacyKey: true,
 * })
 */
export async function migrateAccount(
  options: AccountLocation & {
    from: string
    storage?: AccountStorage
    password?: string
    savePassword?: boolean
    removeLegacyKey?: boolean
  },
): Promise<StoredAccount & { legacyKeyRemoved: boolean }> {
  const storage = options.storage ?? 'plaintext'
  assertStorage(storage, STORAGE_TYPES)
  const removeLegacyKey = options.removeLegacyKey === true
  if (storage === 'none' && removeLegacyKey) {
    throw new KeystoreError(
      'KEY_NOT_STORED',
      'An account stored without its key cannot replace the legacy key; choose another storage or keep the legacy key.',
    )
  }
  const location = resolveLocation(options)

  const legacy = await readLegacyKey(options.from)
  const { account } = legacy
  const { stored, password } = await storeAccount(account, location, {
    storage,
    password: options.password,
    savePassword: options.savePassword,
  })

  if (!removeLegacyKey) return { ...stored, legacyKeyRemoved: false }

  // The legacy copy goes only after the new one has been read back in full.
  await confirmStored(location, account, storage, password ?? options.password, true)
  await writeFileAtomic(options.from, withoutKeyFields(legacy.text, legacy.content, legacy.fields))
  return { ...stored, legacyKeyRemoved: true }
}
