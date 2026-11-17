import { BaseError } from '@provablehq/veil-core'

/** Stable identifiers carried by {@link KeystoreError}. */
export type KeystoreErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'KEY_NOT_STORED'
  | 'ACCOUNT_EXISTS'
  | 'ACCOUNT_BUSY'
  | 'ADDRESS_MISMATCH'
  | 'KEY_CONFLICT'
  | 'EMPTY_KEY_SOURCE'
  | 'INVALID_KEY'
  | 'INVALID_MNEMONIC'
  | 'INVALID_NAME'
  | 'INVALID_ACCOUNT_FILE'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_STORAGE'
  | 'KEYCHAIN_UNAVAILABLE'
  | 'KEYCHAIN_ITEM_NOT_FOUND'
  | 'KEYCHAIN_FAILED'
  | 'PASSWORD_REQUIRED'
  | 'WRONG_PASSWORD'
  | 'TERMINAL_REQUIRED'
  | 'LEGACY_KEY_NOT_FOUND'

/**
 * Reports a failure to store, find or unlock an Aleo account.
 *
 * Every failure the keystore detects is thrown as this class, and callers
 * branch on `code` instead of matching message text. Messages name addresses
 * and file paths and never contain a private key or a password. A file system
 * error on the account file or its directory, other than a missing file
 * (permission denied, a directory in place of the file), propagates unchanged
 * as the platform's own error.
 *
 * @property code Stable identifier of the failure:
 *   - `ACCOUNT_NOT_FOUND`: no source in the lookup order produced a key.
 *   - `KEY_NOT_STORED`: the account file records an address only and no key
 *     came from the environment.
 *   - `ACCOUNT_EXISTS`: saving would replace an existing account file.
 *   - `ACCOUNT_BUSY`: another process is changing the account file, or changed
 *     it while this operation was in progress. Nothing was changed; try again.
 *   - `ADDRESS_MISMATCH`: a key does not match the account file, the expected
 *     address or the Keychain entry.
 *   - `KEY_CONFLICT`: two environment variables resolve to different keys, or
 *     a legacy state file holds two different keys.
 *   - `EMPTY_KEY_SOURCE`: a key variable or key file is set but supplies no key.
 *   - `INVALID_KEY`: a key string cannot be parsed.
 *   - `INVALID_MNEMONIC`: a recovery phrase fails the word list, length or
 *     checksum. Raised by command-line tools built on the keystore.
 *   - `INVALID_NAME`: the account name does not match
 *     `^[a-z0-9][a-z0-9_-]{0,63}$`.
 *   - `INVALID_ACCOUNT_FILE`: the file is not valid JSON or breaks the format.
 *   - `UNSUPPORTED_VERSION`: the file has an unknown `version`.
 *   - `UNSUPPORTED_STORAGE`: the file or the request names an unknown storage.
 *   - `KEYCHAIN_UNAVAILABLE`: Keychain storage requested, or met, outside macOS.
 *   - `KEYCHAIN_ITEM_NOT_FOUND`: the account file points at a Keychain entry
 *     that no longer exists.
 *   - `KEYCHAIN_FAILED`: the macOS `security` tool failed for another reason.
 *   - `PASSWORD_REQUIRED`: an encrypted account and no usable password source.
 *   - `WRONG_PASSWORD`: the password did not decrypt the key.
 *   - `TERMINAL_REQUIRED`: a command that shows a key ran without a terminal.
 *     Raised by command-line tools built on the keystore.
 *   - `LEGACY_KEY_NOT_FOUND`: the file given to `migrateAccount` holds no key.
 *
 * @example
 * import { KeystoreError, loadAccount } from '@provablehq/veil-aleo-sdk/node'
 *
 * try {
 *   await loadAccount()
 * } catch (error) {
 *   if (error instanceof KeystoreError && error.code === 'ACCOUNT_NOT_FOUND') {
 *     // No key in the environment and no account file: create or import one.
 *   } else throw error
 * }
 */
export class KeystoreError extends BaseError {
  readonly code: KeystoreErrorCode

  /**
   * Builds an error for one keystore failure.
   *
   * @param code Stable identifier of the failure.
   * @param message Human-readable detail. MUST NOT contain a key or a password.
   * @param options Standard error options, such as the underlying `cause`.
   */
  constructor(code: KeystoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'KeystoreError'
    this.code = code
  }
}
