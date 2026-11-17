import { decryptKey, normalizePassword, type EncryptedKey } from './encrypted.js'
import { KeystoreError } from './errors.js'
import { PASSWORD_SERVICE, keychainAvailable, readKeychain } from './keychain.js'
import { runtime } from './runtime.js'

/** Variable that supplies the password of an encrypted account. */
export const PASSWORD_VARIABLE = 'ALEO_ACCOUNT_PASSWORD'

/** Number of tries a person gets at a prompt before the call fails. */
const PROMPT_ATTEMPTS = 3

/**
 * Identifies the account a password belongs to.
 *
 * @property name Account name, shown in prompts.
 * @property address Aleo address, shown in prompts and used as the Keychain
 *   account of a saved password.
 */
type PasswordSubject = { name: string; address: string }

/** Reads the password variable, treating an empty value as unset. */
function passwordFromEnvironment(): string | undefined {
  return process.env[PASSWORD_VARIABLE] || undefined
}

/**
 * Names the Keychain entry that holds the saved password of one encrypted file.
 *
 * The entry belongs to a file, not to an address: two encrypted files can hold
 * the same account under different passwords, and each needs its own saved
 * password. The salt is unique to each encryption, so it identifies the file,
 * and it changes whenever the file is encrypted again.
 *
 * @param address Aleo address of the account.
 * @param salt The file's scrypt salt, as standard base64.
 * @returns The entry's account: the address, `-`, and the salt in hex.
 */
export function passwordEntryAccount(address: string, salt: string): string {
  return `${address}-${Buffer.from(salt, 'base64').toString('hex')}`
}

/**
 * Converts a password to the form stored in the Keychain.
 *
 * @param password Normalised password bytes.
 * @returns The bytes as lower-case hex, which needs no quoting.
 */
export function passwordToKeychainValue(password: Buffer): string {
  return password.toString('hex')
}

/**
 * Finds the password of an encrypted account and decrypts its key.
 *
 * Sources, in order: the explicit password, `ALEO_ACCOUNT_PASSWORD`, a password
 * saved in the macOS Keychain, then a hidden prompt when a terminal is
 * attached. The first source that supplies a password decides: a wrong one is
 * an error and the later sources are not tried. Only the prompt retries, up to
 * three times. The Keychain lookup runs the `security` tool on macOS.
 *
 * @param subject Account the password belongs to.
 * @param key The account file's encrypted `key` object.
 * @param options.password Explicit password, as text or as already normalised
 *   bytes.
 * @param options.prompt Whether a prompt may be shown when a terminal is
 *   attached. Defaults to true.
 * @returns The private key and the normalised password that unlocked it.
 * @throws KeystoreError `WRONG_PASSWORD` when the password does not decrypt the
 *   key, `PASSWORD_REQUIRED` when no source supplies one, and `KEYCHAIN_FAILED`
 *   when the saved-password lookup fails.
 */
export async function unlock(
  subject: PasswordSubject,
  key: EncryptedKey,
  options: { password?: string | Buffer; prompt?: boolean },
): Promise<{ privateKey: string; password: Buffer }> {
  const attempt = async (password: Buffer) => ({
    privateKey: await decryptKey(key, subject.address, password),
    password,
  })

  if (options.password !== undefined) {
    return attempt(Buffer.isBuffer(options.password) ? options.password : normalizePassword(options.password))
  }
  const fromEnvironment = passwordFromEnvironment()
  if (fromEnvironment !== undefined) return attempt(normalizePassword(fromEnvironment))

  if (keychainAvailable()) {
    const saved = await readKeychain(PASSWORD_SERVICE, passwordEntryAccount(subject.address, key.kdfParams.salt))
    if (saved !== undefined) {
      // A saved password is the hex of its bytes; anything else was not
      // written by the keystore.
      if (saved.length === 0 || !/^(?:[0-9a-f]{2})+$/.test(saved)) {
        throw new KeystoreError(
          'KEYCHAIN_FAILED',
          `The Keychain entry ${PASSWORD_SERVICE} for ${subject.address} does not hold a saved password.`,
        )
      }
      return attempt(Buffer.from(saved, 'hex'))
    }
  }

  if (options.prompt !== false && runtime.terminalAttached()) {
    for (let tries = 0; tries < PROMPT_ATTEMPTS; tries++) {
      const typed = await runtime.promptHidden(`Password for Aleo account ${subject.name} (${subject.address}): `)
      try {
        return await attempt(normalizePassword(typed))
      } catch (error) {
        const code = error instanceof KeystoreError ? error.code : undefined
        if (code === 'PASSWORD_REQUIRED') runtime.notify('The password must not be empty.')
        else if (code === 'WRONG_PASSWORD') runtime.notify('Wrong password.')
        else throw error
      }
    }
    throw new KeystoreError(
      'WRONG_PASSWORD',
      `No password entered in ${PROMPT_ATTEMPTS} attempts unlocks the account ${subject.address}.`,
    )
  }

  throw new KeystoreError(
    'PASSWORD_REQUIRED',
    `The account ${subject.address} is encrypted and no password is available. ` +
      `Set ${PASSWORD_VARIABLE}, pass a password, or run with a terminal attached.`,
  )
}

/**
 * Obtains the password a new encrypted account file is written with.
 *
 * Sources, in order: the explicit candidates, `ALEO_ACCOUNT_PASSWORD` when
 * allowed, then a hidden prompt that asks twice when a terminal is attached.
 * The prompt repeats up to three times while the entries are empty or differ.
 *
 * @param subject Account the password will protect.
 * @param options.explicit Passwords supplied by the caller, most specific
 *   first; the first defined one is used.
 * @param options.environment Whether `ALEO_ACCOUNT_PASSWORD` may supply the
 *   password. False when replacing an existing password, where the variable
 *   holds the old one.
 * @param options.prompt Whether a prompt may be shown when a terminal is
 *   attached.
 * @returns The normalised password bytes.
 * @throws KeystoreError `PASSWORD_REQUIRED` when a supplied password is empty,
 *   when no source supplies one, or when the prompt is used up.
 */
export async function chooseNewPassword(
  subject: PasswordSubject,
  options: { explicit: ReadonlyArray<string | undefined>; environment: boolean; prompt: boolean },
): Promise<Buffer> {
  for (const candidate of options.explicit) {
    if (candidate !== undefined) return normalizePassword(candidate)
  }
  if (options.environment) {
    const fromEnvironment = passwordFromEnvironment()
    if (fromEnvironment !== undefined) return normalizePassword(fromEnvironment)
  }

  if (options.prompt && runtime.terminalAttached()) {
    for (let tries = 0; tries < PROMPT_ATTEMPTS; tries++) {
      const first = await runtime.promptHidden(`New password for Aleo account ${subject.name} (${subject.address}): `)
      const second = await runtime.promptHidden('Repeat the new password: ')
      if (first.normalize('NFKC').length === 0) {
        runtime.notify('The password must not be empty.')
        continue
      }
      const password = normalizePassword(first)
      // Compared after normalisation, which is the form that is stretched.
      if (password.equals(Buffer.from(second.normalize('NFKC'), 'utf8'))) return password
      runtime.notify('The passwords do not match.')
    }
    throw new KeystoreError('PASSWORD_REQUIRED', `No password was set for the account ${subject.address} in ${PROMPT_ATTEMPTS} attempts.`)
  }

  throw new KeystoreError(
    'PASSWORD_REQUIRED',
    `Encrypting the account ${subject.address} needs a password. Pass one` +
      `${options.environment ? `, set ${PASSWORD_VARIABLE},` : ''} or run with a terminal attached.`,
  )
}
