import { randomBytes } from 'node:crypto'
import { KeystoreError } from './errors.js'
import { runtime } from './runtime.js'

/**
 * Keychain service holding private keys. The entry's account names one account
 * file: the address followed by an identifier chosen when the file is written.
 */
export const KEY_SERVICE = 'aleo-account-key'

/** Length of the identifier in a key entry's account, in bytes. */
const KEY_ENTRY_ID_BYTES = 16

/**
 * Names a new Keychain entry for the key of one account file.
 *
 * Every account file gets an entry of its own. Entries are never shared
 * between files that were stored separately, so writing, undoing or removing
 * one file's entry cannot affect another file that holds the same key. The
 * account file records the name, so the entry is found again after the file
 * is renamed or moved.
 *
 * @param address Aleo address of the account.
 * @returns The entry's account: the address, `-`, and 16 random bytes in hex.
 */
export function newKeyEntryAccount(address: string): string {
  return `${address}-${randomBytes(KEY_ENTRY_ID_BYTES).toString('hex')}`
}

/**
 * Checks that a key entry's account belongs to an address.
 *
 * @param account The `account` recorded in an account file.
 * @param address The address recorded in the same file.
 * @returns True when the account is the address, `-`, and 32 hex characters.
 */
export function isKeyEntryAccount(account: string, address: string): boolean {
  return account.startsWith(`${address}-`) && /^[0-9a-f]{32}$/.test(account.slice(address.length + 1))
}

/**
 * Keychain service holding saved passwords. The entry's account names one
 * encrypted file: the address followed by the file's salt.
 */
export const PASSWORD_SERVICE = 'aleo-account-password'

/** Exit status `security` returns when the requested entry does not exist. */
const ITEM_NOT_FOUND_STATUS = 44

/**
 * Text that can be placed on a `security -i` command line without quoting.
 * Addresses, private keys and hex strings all satisfy it.
 */
const UNQUOTED = /^[A-Za-z0-9]+$/

/**
 * Entry accounts that can be placed on a `security -i` command line without
 * quoting: an address, optionally followed by `-` and an identifier in hex.
 */
const ENTRY_ACCOUNT = /^[A-Za-z0-9]+(?:-[0-9a-f]+)?$/

/** Account names as they may appear, unquoted, in an entry's label. */
const LABEL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * Reports whether the macOS Keychain exists on this system.
 *
 * @returns True on macOS only.
 */
export function keychainAvailable(): boolean {
  return runtime.platform === 'darwin'
}

/**
 * Stops an operation that needs the macOS Keychain on another system.
 *
 * @param detail Sentence naming what needed the Keychain and what to do
 *   instead.
 * @throws KeystoreError `KEYCHAIN_UNAVAILABLE` outside macOS.
 */
export function requireKeychain(detail: string): void {
  if (!keychainAvailable()) {
    throw new KeystoreError('KEYCHAIN_UNAVAILABLE', `The macOS Keychain is not available on this system. ${detail}`)
  }
}

/**
 * Builds the error for a Keychain failure without echoing the tool's output.
 *
 * @param action What was being done to the entry, as a present participle.
 * @param service Keychain service name.
 * @param address Aleo address the entry belongs to.
 * @param reason What went wrong, completing "The security tool ...".
 */
function failed(action: string, service: string, address: string, reason: string): KeystoreError {
  return new KeystoreError(
    'KEYCHAIN_FAILED',
    `The security tool ${reason} while ${action} the Keychain entry ${service} for ${address}.`,
  )
}

/** Describes a non-zero or missing exit status of the `security` tool. */
function exitReason(status: number | null): string {
  return status === null
    ? 'could not be started or did not finish within 15 seconds'
    : `exited with status ${status}`
}

/**
 * Reads one generic password from the macOS login keychain.
 *
 * @param service Keychain service name.
 * @param address Aleo address, used as the entry's account.
 * @returns The stored value, or `undefined` when the entry does not exist.
 * @throws KeystoreError `KEYCHAIN_FAILED` when the tool fails for any reason
 *   other than a missing entry.
 */
export async function readKeychain(service: string, address: string): Promise<string | undefined> {
  const { status, stdout } = await runtime.security(['find-generic-password', '-s', service, '-a', address, '-w'])
  if (status === ITEM_NOT_FOUND_STATUS) return undefined
  if (status !== 0) throw failed('reading', service, address, exitReason(status))
  // The tool prints the value followed by one line ending.
  return stdout.replace(/\r?\n$/, '')
}

/**
 * Creates or replaces one generic password in the macOS login keychain.
 *
 * The command travels on the tool's standard input, so the value never appears
 * in the process arguments. The entry is read back afterwards to confirm it
 * holds the value.
 *
 * The entry is found by service and account. Its label, the name Keychain
 * Access shows, is `<service>:<name>`, so entries of several accounts can be
 * told apart; the label takes no part in finding the entry.
 *
 * The existing entry is read first, and one that already holds the value is
 * left as it is.
 *
 * @param service Keychain service name.
 * @param address The entry's account: an Aleo address followed by `-` and an
 *   identifier in hex.
 * @param value Secret to store. MUST be ASCII letters and digits only.
 * @param name Account name, shown in the entry's label.
 * @returns True when this call created the entry; false when an entry already
 *   existed. Only an entry a caller created is the caller's to remove if a
 *   later step fails.
 * @throws KeystoreError `KEYCHAIN_FAILED` when the tool fails or the entry does
 *   not hold the value afterwards.
 */
export async function writeKeychain(service: string, address: string, value: string, name: string): Promise<boolean> {
  // Nothing here is quoted, so anything able to split or extend the command
  // line is refused before the tool runs.
  if (!ENTRY_ACCOUNT.test(address) || !UNQUOTED.test(value) || !LABEL_NAME.test(name)) {
    throw failed('writing', service, address, 'was not run, because the value cannot be passed unquoted,')
  }
  const existing = await readKeychain(service, address)
  if (existing === value) return false
  const command = `add-generic-password -U -s ${service} -a ${address} -l ${service}:${name} -w ${value}\n`
  const { status } = await runtime.security(['-i'], command)
  if (status !== 0) throw failed('writing', service, address, exitReason(status))
  if ((await readKeychain(service, address)) !== value) {
    throw failed('verifying', service, address, 'did not store the value')
  }
  return existing === undefined
}

/**
 * Deletes one generic password from the macOS login keychain.
 *
 * An entry that is already absent counts as deleted.
 *
 * @param service Keychain service name.
 * @param address Aleo address, used as the entry's account.
 * @throws KeystoreError `KEYCHAIN_FAILED` when the tool fails for any reason
 *   other than a missing entry.
 */
export async function deleteKeychain(service: string, address: string): Promise<void> {
  const { status } = await runtime.security(['delete-generic-password', '-s', service, '-a', address])
  if (status !== 0 && status !== ITEM_NOT_FOUND_STATUS) throw failed('deleting', service, address, exitReason(status))
}
