import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'

const HARDENED_OFFSET = 0x80000000

// Aleo-specific HMAC key for HD master derivation (parallel to BIP32's
// "Bitcoin seed", but for BLS12-377). Matches shield-core.
const BLS12_377_CURVE = 'bls12_377 seed'

const PATH_REGEX = /^m(\/[0-9]+')+$/

export type AleoDerivationId = 'standard' | 'legacy'

/** SLIP-0044 registered Aleo coin type. */
export const STANDARD_PATH = "m/44'/683'"

/** Pre-SLIP-0044-registration derivation path. Some older wallets used this. */
export const LEGACY_PATH = "m/44'/0'"

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

export class BLS12377HDKey {
  constructor(
    public readonly key: Uint8Array,
    public readonly chainCode: Uint8Array,
  ) {}

  static fromMasterSeed(seed: Uint8Array): BLS12377HDKey {
    const master = getMasterKeyFromSeed(seed)
    return new BLS12377HDKey(master.key, master.chainCode)
  }

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

  derivePath(path: string): BLS12377HDKey {
    return this.derive(path)
  }

  deriveChild(index: number): BLS12377HDKey {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new Error(
        `Invalid child index: ${index} (must be integer in [0, 2³¹))`,
      )
    }
    return this.derive(`m/${index}'/0'`)
  }
}

export function generateMnemonic(strength: 128 | 256 = 128): string {
  return bip39.generateMnemonic(wordlist, strength)
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, wordlist)
}

export function validateWord(word: string): boolean {
  return wordlist.includes(word)
}

export function mnemonicToSeed(mnemonic: string): Uint8Array {
  return bip39.mnemonicToSeedSync(mnemonic)
}

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
