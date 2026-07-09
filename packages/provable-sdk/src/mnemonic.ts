import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'

const HARDENED_OFFSET = 0x80000000

// Aleo-specific HMAC key for HD master derivation (parallel to BIP32's
// "Bitcoin seed", but for BLS12-377). Matches shield-core.
const BLS12_377_CURVE = 'bls12_377 seed'

const PATH_REGEX = /^m(\/[0-9]+')+$/

/**
 * Names the derivation-path convention used to turn a seed into Aleo keys.
 *
 * `'standard'` uses the SLIP-0044-registered Aleo coin type (`m/44'/683'`);
 * `'legacy'` uses the pre-registration path (`m/44'/0'`) some older wallets
 * chose. Pick `'legacy'` only to recover accounts created by such a wallet.
 */
export type AleoDerivationId = 'standard' | 'legacy'

/** SLIP-0044 registered Aleo coin type. */
export const STANDARD_PATH = "m/44'/683'"

/** Pre-SLIP-0044-registration derivation path. Some older wallets used this. */
export const LEGACY_PATH = "m/44'/0'"

/** Maps each {@link AleoDerivationId} to its account-level derivation path. */
export const DERIVATION_PATHS: Record<AleoDerivationId, string> = {
  standard: STANDARD_PATH,
  legacy: LEGACY_PATH,
}

interface IKeys {
  key: Uint8Array
  chainCode: Uint8Array
}

function uint32BE(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`uint32BE: value out of range (got ${n})`)
  }
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n, false)
  return out
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function ckdPriv({ key, chainCode }: IKeys, index: number): IKeys {
  const data = concatBytes(new Uint8Array([0]), key, uint32BE(index))
  const I = hmac(sha512, chainCode, data)
  return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

function getMasterKeyFromSeed(seed: Uint8Array): IKeys {
  const I = hmac(sha512, BLS12_377_CURVE, seed)
  return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

function isValidPath(path: string): boolean {
  if (!PATH_REGEX.test(path)) return false
  return path
    .split('/')
    .slice(1)
    .map((s) => s.replace("'", ''))
    .every((s) => Number.isFinite(Number(s)))
}

/**
 * Hierarchical-deterministic key node for the BLS12-377 curve Aleo uses.
 *
 * Follows the SLIP-0010 construction (HMAC-SHA512 chains, hardened-only
 * derivation) with an Aleo-specific master key tag, matching shield-core.
 * All operations are pure and local — nothing touches the network. Start
 * from {@link BLS12377HDKey.fromMasterSeed} (or {@link mnemonicToHDKey})
 * rather than the constructor; the 32-byte `key` of a derived node is the
 * seed for an Aleo private key.
 */
export class BLS12377HDKey {
  /**
   * Wraps raw node material. Callers normally use
   * {@link BLS12377HDKey.fromMasterSeed} instead of constructing directly.
   *
   * @param key 32-byte private key material of this node.
   * @param chainCode 32-byte chain code used to derive children.
   */
  constructor(
    public readonly key: Uint8Array,
    public readonly chainCode: Uint8Array,
  ) {}

  /**
   * Derives the master node from a BIP-39 seed. Pure and local.
   *
   * @param seed Seed bytes, typically the 64-byte output of
   *   {@link mnemonicToSeed}.
   * @returns The root node from which paths are derived.
   */
  static fromMasterSeed(seed: Uint8Array): BLS12377HDKey {
    const master = getMasterKeyFromSeed(seed)
    return new BLS12377HDKey(master.key, master.chainCode)
  }

  /**
   * Derives the descendant node at a hardened path. Pure and local.
   *
   * @param path Path of the form `m/44'/683'` — every segment MUST be
   *   hardened (trailing `'`) and below 2^31.
   * @returns A new node; this node is unchanged.
   * @throws If the path is malformed, contains a non-hardened segment, or a
   *   segment is out of range.
   */
  derive(path: string): BLS12377HDKey {
    if (!isValidPath(path)) {
      throw new Error(
        `Invalid derivation path: ${path} (must match m/N'/N'/... — hardened only)`,
      )
    }
    const segments = path
      .split('/')
      .slice(1)
      .map((s) => parseInt(s.replace("'", ''), 10))

    for (const seg of segments) {
      if (seg >= HARDENED_OFFSET) {
        throw new Error(
          `Derivation path segment out of range: ${seg} (must be < 2³¹)`,
        )
      }
    }

    const result = segments.reduce(
      (acc, segment) => ckdPriv(acc, segment + HARDENED_OFFSET),
      { key: this.key, chainCode: this.chainCode } as IKeys,
    )
    return new BLS12377HDKey(result.key, result.chainCode)
  }

  /** Alias for {@link BLS12377HDKey.derive}, kept for HD-key API parity. */
  derivePath(path: string): BLS12377HDKey {
    return this.derive(path)
  }

  /**
   * Derives the account node at `m/{index}'/0'` relative to this node. Pure
   * and local. Applied to a {@link DERIVATION_PATHS} node, this yields the
   * account at that index.
   *
   * @param index Zero-based account index, below 2^31; hardening is applied
   *   internally.
   * @returns The account-level node.
   * @throws If the index is negative, fractional, or 2^31 or greater.
   */
  deriveChild(index: number): BLS12377HDKey {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new Error(
        `Invalid child index: ${index} (must be integer in [0, 2³¹))`,
      )
    }
    return this.derive(`m/${index}'/0'`)
  }
}

/**
 * Generates a fresh BIP-39 mnemonic from the English wordlist.
 *
 * Draws entropy from the platform CSPRNG; no network access. The phrase is
 * the root secret for every account derived from it — the caller MUST store
 * it securely and never log it.
 *
 * @param strength Entropy in bits: 128 yields 12 words, 256 yields 24.
 *   Defaults to 128.
 * @returns A space-separated mnemonic phrase.
 *
 * @example
 * import { generateMnemonic, mnemonicToHDKey } from '@provablehq/veil-sdk'
 *
 * const mnemonic = generateMnemonic()
 * const account0 = mnemonicToHDKey(mnemonic)
 */
export function generateMnemonic(strength: 128 | 256 = 128): string {
  return bip39.generateMnemonic(wordlist, strength)
}

/**
 * Checks a full mnemonic phrase against BIP-39: English wordlist membership,
 * word count, and checksum. Pure and local.
 *
 * @param mnemonic Space-separated candidate phrase.
 * @returns True only if the phrase can be used for key derivation; a single
 *   wrong or reordered word fails the checksum.
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, wordlist)
}

/**
 * Checks whether a single word belongs to the English BIP-39 wordlist. Pure
 * and local. Use for per-word feedback while a phrase is being typed;
 * validating the complete phrase still requires {@link validateMnemonic}.
 *
 * @param word Candidate word, lowercase.
 * @returns True if the word is one of the 2048 list entries.
 */
export function validateWord(word: string): boolean {
  return wordlist.includes(word)
}

/**
 * Converts a mnemonic to its 64-byte BIP-39 seed via PBKDF2-HMAC-SHA512 with
 * an empty passphrase. Pure, local, and deterministic.
 *
 * The mnemonic is not validated here — call {@link validateMnemonic} first;
 * an invalid phrase still produces a seed, only for the wrong accounts.
 *
 * @param mnemonic Space-separated BIP-39 phrase.
 * @returns Seed bytes for {@link BLS12377HDKey.fromMasterSeed}.
 */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  return bip39.mnemonicToSeedSync(mnemonic)
}

/**
 * Derives the Aleo account key at the given index from a mnemonic in one
 * step: seed, master node, derivation path, account child. Pure and local.
 * This is the usual entry point for turning a stored phrase into key
 * material.
 *
 * @param mnemonic Space-separated BIP-39 phrase.
 * @param options.index Zero-based account index, below 2^31. Defaults to 0.
 * @param options.derivation Path convention. Defaults to `'standard'`
 *   (`m/44'/683'`); pass `'legacy'` to recover accounts from wallets that
 *   predate the SLIP-0044 registration.
 * @returns The account node; its `key` bytes seed the Aleo private key.
 * @throws If the index is out of range.
 *
 * @example
 * import { mnemonicToHDKey } from '@provablehq/veil-sdk'
 *
 * const hdKey = mnemonicToHDKey(mnemonic, { index: 1 })
 */
export function mnemonicToHDKey(
  mnemonic: string,
  options: { index?: number; derivation?: AleoDerivationId } = {},
): BLS12377HDKey {
  const { index = 0, derivation = 'standard' } = options
  const seed = mnemonicToSeed(mnemonic)
  return BLS12377HDKey.fromMasterSeed(seed)
    .derivePath(DERIVATION_PATHS[derivation])
    .deriveChild(index)
}
