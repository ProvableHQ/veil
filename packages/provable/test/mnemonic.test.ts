import { describe, it, expect } from 'vitest'
import {
  BLS12377HDKey,
  generateMnemonic,
  validateMnemonic,
  validateWord,
  mnemonicToSeed,
  mnemonicToHDKey,
  STANDARD_PATH,
  LEGACY_PATH,
} from '../src/mnemonic.js'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const toHex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')

describe('Mnemonic', () => {
  describe('generateMnemonic', () => {
    it('generates a 12-word mnemonic by default', () => {
      const m = generateMnemonic()
      expect(m.split(' ')).toHaveLength(12)
      expect(validateMnemonic(m)).toBe(true)
    })

    it('generates a 24-word mnemonic for strength 256', () => {
      const m = generateMnemonic(256)
      expect(m.split(' ')).toHaveLength(24)
      expect(validateMnemonic(m)).toBe(true)
    })

    it('generates unique mnemonics each call', () => {
      expect(generateMnemonic()).not.toBe(generateMnemonic())
    })
  })

  describe('validateMnemonic', () => {
    it('accepts a valid 12-word mnemonic', () => {
      expect(validateMnemonic(TEST_MNEMONIC)).toBe(true)
    })

    it('rejects a mnemonic with an unknown word', () => {
      expect(
        validateMnemonic(
          'aaaaaa abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        ),
      ).toBe(false)
    })

    it('rejects a mnemonic with bad checksum', () => {
      // Last word swapped to a different valid wordlist word — checksum fails.
      expect(
        validateMnemonic(
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon',
        ),
      ).toBe(false)
    })

    it('rejects empty input', () => {
      expect(validateMnemonic('')).toBe(false)
    })
  })

  describe('validateWord', () => {
    it('accepts wordlist words', () => {
      expect(validateWord('abandon')).toBe(true)
      expect(validateWord('about')).toBe(true)
    })

    it('rejects non-wordlist words', () => {
      expect(validateWord('definitely-not-a-bip39-word')).toBe(false)
      expect(validateWord('')).toBe(false)
    })
  })

  describe('mnemonicToSeed', () => {
    it('produces a 64-byte seed', () => {
      expect(mnemonicToSeed(TEST_MNEMONIC).length).toBe(64)
    })

    it('is deterministic', () => {
      const a = mnemonicToSeed(TEST_MNEMONIC)
      const b = mnemonicToSeed(TEST_MNEMONIC)
      expect(toHex(a)).toBe(toHex(b))
    })

    // BIP39 standard test vector: abandon×11 + about, empty passphrase.
    // First 32 bytes of the canonical PBKDF2 seed. This validates our
    // bip39 layer against the published BIP39 reference.
    it('matches BIP39 reference vector for the canonical test mnemonic', () => {
      const seed = mnemonicToSeed(TEST_MNEMONIC)
      expect(toHex(seed.slice(0, 32))).toBe(
        '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1',
      )
    })
  })
})

describe('BLS12377HDKey', () => {
  // Hex seed used by shield-core's tests, kept identical so vectors can be
  // cross-checked against shield-core if anyone runs both.
  const HEX_SEED = '00112233445566778899aabbccddeeff'
  const hexSeedBytes = (): Uint8Array => {
    const m = HEX_SEED.match(/.{2}/g)!
    return new Uint8Array(m.map((b) => parseInt(b, 16)))
  }

  describe('fromMasterSeed', () => {
    it('produces 32-byte key and chainCode', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(root.key.length).toBe(32)
      expect(root.chainCode.length).toBe(32)
    })

    it('is deterministic for the same seed', () => {
      const a = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      const b = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(toHex(a.key)).toBe(toHex(b.key))
      expect(toHex(a.chainCode)).toBe(toHex(b.chainCode))
    })

    it('produces different output for different seeds', () => {
      const a = BLS12377HDKey.fromMasterSeed(new Uint8Array(16).fill(0))
      const b = BLS12377HDKey.fromMasterSeed(new Uint8Array(16).fill(1))
      expect(toHex(a.key)).not.toBe(toHex(b.key))
    })
  })

  describe('derivePath', () => {
    it('is deterministic', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      const a = root.derivePath("m/44'/0'")
      const b = root.derivePath("m/44'/0'")
      expect(toHex(a.key)).toBe(toHex(b.key))
      expect(toHex(a.chainCode)).toBe(toHex(b.chainCode))
    })

    it('produces different keys for different paths', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      const a = root.derivePath("m/44'/0'")
      const b = root.derivePath("m/44'/683'")
      expect(toHex(a.key)).not.toBe(toHex(b.key))
    })

    it('rejects non-hardened paths', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(() => root.derivePath('m/44/0')).toThrow(/Invalid derivation path/)
    })

    it('rejects malformed paths', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(() => root.derivePath('not-a-path')).toThrow(/Invalid derivation path/)
      expect(() => root.derivePath('')).toThrow(/Invalid derivation path/)
      expect(() => root.derivePath('m')).toThrow(/Invalid derivation path/)
    })

    it('rejects path segments at or above 2³¹', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(() => root.derivePath("m/2147483648'")).toThrow(/out of range/)
    })
  })

  describe('deriveChild', () => {
    it('produces 32-byte key and chainCode', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      const child = root.deriveChild(7)
      expect(child.key.length).toBe(32)
      expect(child.chainCode.length).toBe(32)
    })

    it('produces different keys for different indices', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(toHex(root.deriveChild(0).key)).not.toBe(toHex(root.deriveChild(1).key))
    })

    it('rejects non-integer indices', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(() => root.deriveChild(1.5)).toThrow(/Invalid child index/)
      expect(() => root.deriveChild(NaN)).toThrow(/Invalid child index/)
    })

    it('rejects negative indices', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(() => root.deriveChild(-1)).toThrow(/Invalid child index/)
    })

    it('rejects indices at or above 2³¹', () => {
      const root = BLS12377HDKey.fromMasterSeed(hexSeedBytes())
      expect(() => root.deriveChild(0x80000000)).toThrow(/Invalid child index/)
    })
  })
})

describe('mnemonicToHDKey', () => {
  it('defaults to standard derivation, index 0', () => {
    const a = mnemonicToHDKey(TEST_MNEMONIC)
    const b = mnemonicToHDKey(TEST_MNEMONIC, { index: 0, derivation: 'standard' })
    expect(toHex(a.key)).toBe(toHex(b.key))
  })

  it('produces different keys for standard vs legacy paths', () => {
    const std = mnemonicToHDKey(TEST_MNEMONIC, { derivation: 'standard' })
    const lgc = mnemonicToHDKey(TEST_MNEMONIC, { derivation: 'legacy' })
    expect(toHex(std.key)).not.toBe(toHex(lgc.key))
  })

  it('produces different keys for different indices', () => {
    const a = mnemonicToHDKey(TEST_MNEMONIC, { index: 0 })
    const b = mnemonicToHDKey(TEST_MNEMONIC, { index: 1 })
    expect(toHex(a.key)).not.toBe(toHex(b.key))
  })
})

// Regression vectors captured from this implementation. They lock our output
// in place so future code changes can't silently alter derivation output.
// These DO NOT cross-validate against shield-core — see the skipped suite below
// for that.
describe('regression vectors (this implementation)', () => {
  it(`hex seed ${'00112233445566778899aabbccddeeff'} → master`, () => {
    const seed = new Uint8Array(
      '00112233445566778899aabbccddeeff'
        .match(/.{2}/g)!
        .map((b) => parseInt(b, 16)),
    )
    const root = BLS12377HDKey.fromMasterSeed(seed)
    expect(toHex(root.key)).toBe(
      '3bc843b7fe5e44d16cb21ac77746be3bf1c36f1741bcf387641602d391c08db9',
    )
    expect(toHex(root.chainCode)).toBe(
      'f8585b2228a37ee82393a78093d84e8959e8aa86081c8d2587b91ef19a4788d0',
    )
    expect(toHex(root.deriveChild(7).key)).toBe(
      'd651068a71dec0b1b238c0b51120a7ae93de12434fc2768992af926727f87454',
    )
  })

  it('test mnemonic → standard path index 0', () => {
    const hd = mnemonicToHDKey(TEST_MNEMONIC)
    expect(toHex(hd.key)).toBe(
      'c253767bf33bfafba853567bf7d613abfb48bdab5b2a2b5b734b1530ff2402cd',
    )
    expect(toHex(hd.chainCode)).toBe(
      '46e06e9f3ec76a3533b8926c1ebe6c7bcde7cb26b39f25170240b1c94f7688e0',
    )
  })

  it('test mnemonic → standard path index 1', () => {
    const hd = mnemonicToHDKey(TEST_MNEMONIC, { index: 1 })
    expect(toHex(hd.key)).toBe(
      '6be39dabd985e8534a288512fcb90130befa995ad05f0955a97dc1bd7560491b',
    )
  })

  it('test mnemonic → legacy path index 0', () => {
    const hd = mnemonicToHDKey(TEST_MNEMONIC, { derivation: 'legacy' })
    expect(toHex(hd.key)).toBe(
      '7303bce3fd710072aec3c0b0564f061d3771c3c10a2e023cacdedcf5d2ce6b72',
    )
  })
})

// Cross-implementation vectors against shield-core require the @provablehq/sdk
// to derive an Aleo address from the HD key bytes, so they live in
// provable.test.ts (which loads the SDK) — see the `mnemonicToAccount` block
// there.

// Sanity check that our exported path constants match the documented values.
describe('derivation path constants', () => {
  it("STANDARD_PATH is m/44'/683'", () => {
    expect(STANDARD_PATH).toBe("m/44'/683'")
  })

  it("LEGACY_PATH is m/44'/0'", () => {
    expect(LEGACY_PATH).toBe("m/44'/0'")
  })
})
