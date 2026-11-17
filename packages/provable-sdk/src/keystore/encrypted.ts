import { randomBytes, scrypt } from 'node:crypto'
import { PrivateKey, PrivateKeyCiphertext } from '@provablehq/sdk'
import { KeystoreError } from './errors.js'

/** scrypt cost used for every new encrypted account file. */
export const SCRYPT_N = 131072
/** scrypt block size. The only value a reader accepts. */
export const SCRYPT_R = 8
/** scrypt parallelisation. The only value a reader accepts. */
export const SCRYPT_P = 1
/** Smallest scrypt cost a reader accepts (2^14). */
export const SCRYPT_MIN_N = 2 ** 14
/** Largest scrypt cost a reader accepts (2^20), which bounds memory at 1 GiB. */
export const SCRYPT_MAX_N = 2 ** 20
/** Salt length for new files, and the shortest salt a reader accepts, in bytes. */
export const SALT_BYTES = 16

/** Length of the scrypt output, in bytes. */
const SECRET_BYTES = 32
/** Memory allowed to scrypt at the default cost, in bytes (256 MiB). */
const BASE_MAXMEM = 256 * 1024 * 1024

/**
 * The `key` object of an encrypted account file.
 *
 * @property type Always `'encrypted'`.
 * @property kdf Always `'scrypt'`.
 * @property kdfParams scrypt cost `N`, block size `r`, parallelisation `p`, and
 *   the salt as standard base64 with padding.
 * @property ciphertext The private key ciphertext (`ciphertext1...`).
 */
export type EncryptedKey = {
  type: 'encrypted'
  kdf: 'scrypt'
  kdfParams: { N: number; r: number; p: number; salt: string }
  ciphertext: string
}

/**
 * Parses an Aleo private key and derives its address.
 *
 * @param privateKey Candidate private key string.
 * @param origin Where the string came from, named in the error message.
 * @returns The key in its canonical text form and the address it derives.
 * @throws KeystoreError `INVALID_KEY` when the string is not a private key. The
 *   message names the origin and never the string.
 */
export function parseKey(privateKey: unknown, origin: string): { privateKey: string; address: string } {
  let key: PrivateKey
  try {
    if (typeof privateKey !== 'string') throw new TypeError('not a string')
    key = PrivateKey.from_string(privateKey)
  } catch {
    // The underlying error is dropped so nothing derived from the input can
    // reach a log through the error chain.
    throw new KeystoreError('INVALID_KEY', `${origin} is not a valid Aleo private key.`)
  }
  try {
    return { privateKey: key.to_string(), address: key.to_address().to_string() }
  } finally {
    key.free()
  }
}

/**
 * Converts a password to the bytes that are stretched and stored.
 *
 * @param password Password as typed or supplied.
 * @returns The password normalised to Unicode NFKC and encoded as UTF-8.
 * @throws KeystoreError `PASSWORD_REQUIRED` when the password is empty.
 */
export function normalizePassword(password: unknown): Buffer {
  if (typeof password !== 'string' || password.normalize('NFKC').length === 0) {
    throw new KeystoreError('PASSWORD_REQUIRED', 'The password must not be empty.')
  }
  return Buffer.from(password.normalize('NFKC'), 'utf8')
}

/**
 * Stretches a password into the secret that encrypts the private key.
 *
 * Runs scrypt with `r = 8`, `p = 1` and a 32-byte output. Takes about 200 ms
 * and 128 MiB at the default cost.
 *
 * @param password Normalised password bytes from {@link normalizePassword}.
 * @param salt Salt bytes.
 * @param N scrypt cost, a power of two.
 * @returns The 32-byte output as 64 lower-case hex characters.
 */
export function deriveSecret(password: Buffer, salt: Buffer, N: number): Promise<string> {
  // scrypt needs 128 * N * r bytes plus a few kilobytes. 256 MiB covers the
  // default cost; a file with a larger accepted cost gets what it needs, and
  // the reader's upper bound on N keeps that at about 1 GiB.
  const maxmem = Math.max(BASE_MAXMEM, 128 * N * SCRYPT_R + 1024 * 1024)
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SECRET_BYTES, { N, r: SCRYPT_R, p: SCRYPT_P, maxmem }, (error, derived) => {
      if (error) reject(error)
      else resolve(derived.toString('hex'))
    })
  })
}

/**
 * Encrypts a private key under a password with a fresh random salt.
 *
 * @param privateKey Aleo private key in text form.
 * @param password Normalised password bytes from {@link normalizePassword}.
 * @returns The `key` object for an encrypted account file.
 */
export async function encryptKey(privateKey: string, password: Buffer): Promise<EncryptedKey> {
  const salt = randomBytes(SALT_BYTES)
  const secret = await deriveSecret(password, salt, SCRYPT_N)
  const key = PrivateKey.from_string(privateKey)
  try {
    const ciphertext = PrivateKeyCiphertext.encryptPrivateKey(key, secret)
    try {
      return {
        type: 'encrypted',
        kdf: 'scrypt',
        kdfParams: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt: salt.toString('base64') },
        ciphertext: ciphertext.toString(),
      }
    } finally {
      ciphertext.free()
    }
  } finally {
    key.free()
  }
}

/**
 * Decrypts the private key of an encrypted account file.
 *
 * @param key The file's `key` object, already checked against the format.
 * @param address Address recorded in the file.
 * @param password Normalised password bytes from {@link normalizePassword}.
 * @returns The private key in text form.
 * @throws KeystoreError `WRONG_PASSWORD` when decryption fails or the decrypted
 *   key derives an address other than the file's.
 */
export async function decryptKey(key: EncryptedKey, address: string, password: Buffer): Promise<string> {
  const secret = await deriveSecret(password, Buffer.from(key.kdfParams.salt, 'base64'), key.kdfParams.N)
  const wrong = () => new KeystoreError('WRONG_PASSWORD', `The password does not unlock the account ${address}.`)
  let privateKey: string
  let derived: string
  try {
    const ciphertext = PrivateKeyCiphertext.fromString(key.ciphertext)
    try {
      const decrypted = ciphertext.decryptToPrivateKey(secret)
      try {
        privateKey = decrypted.to_string()
        derived = decrypted.to_address().to_string()
      } finally {
        decrypted.free()
      }
    } finally {
      ciphertext.free()
    }
  } catch {
    throw wrong()
  }
  // A decryption that succeeds still has to produce the recorded account.
  if (derived !== address) throw wrong()
  return privateKey
}
