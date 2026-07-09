---
sidebar_position: 14
---

# Mnemonics

`@provablehq/veil-aleo-sdk` exports a self-contained BIP-39 / HD-derivation
toolkit for deriving Aleo keys from a mnemonic phrase. Every function here is
pure and local — none touches the network — and none requires
[`loadNetwork`](./loadNetwork); import them directly.

## generateMnemonic

Generates a fresh BIP-39 mnemonic from the English wordlist, drawing entropy
from the platform CSPRNG. The phrase is the root secret for every account
derived from it — it MUST be stored securely and never logged.

```ts
import { generateMnemonic, mnemonicToHDKey } from '@provablehq/veil-aleo-sdk'

const mnemonic = generateMnemonic() // 12 words
const account0 = mnemonicToHDKey(mnemonic)
```

**Parameters**

- `strength: 128 | 256` — optional, defaults to `128`. Entropy bits: 128
  yields 12 words, 256 yields 24.

**Returns** `string` — a space-separated mnemonic phrase.

## validateMnemonic

Checks a full mnemonic phrase against BIP-39: English wordlist membership,
word count, and checksum. A single wrong or reordered word fails the
checksum.

```ts
import { validateMnemonic } from '@provablehq/veil-aleo-sdk'

validateMnemonic(
  'absurd letter switch already canoe piano wage sock unique all blade coyote',
)
// true
```

**Parameters**

- `mnemonic: string` — space-separated candidate phrase.

**Returns** `boolean` — true only if the phrase can be used for key
derivation.

## validateWord

Checks whether a single word belongs to the English BIP-39 wordlist. Applies
to per-word feedback while a phrase is being typed; validating a complete
phrase still requires `validateMnemonic`.

```ts
import { validateWord } from '@provablehq/veil-aleo-sdk'

validateWord('absurd') // true
```

**Parameters**

- `word: string` — candidate word, lowercase.

**Returns** `boolean` — true if the word is one of the 2048 list entries.

## mnemonicToSeed

Converts a mnemonic to its 64-byte BIP-39 seed via PBKDF2-HMAC-SHA512 with an
empty passphrase. Deterministic. The mnemonic is not validated here —
`validateMnemonic` runs first when validation matters; an invalid phrase
still produces a seed, only for the wrong accounts.

```ts
import { mnemonicToSeed } from '@provablehq/veil-aleo-sdk'

const seed = mnemonicToSeed(mnemonic) // 64 bytes
```

**Parameters**

- `mnemonic: string` — space-separated BIP-39 phrase.

**Returns** `Uint8Array` — seed bytes for `BLS12377HDKey.fromMasterSeed`.

## mnemonicToHDKey

Derives the Aleo account key at a given index from a mnemonic in one step:
seed, master node, derivation path, account child. The usual entry point for
turning a stored phrase into key material —
[`mnemonicToAccount`](./mnemonicToAccount) builds the same private key on top
of this.

```ts
import { mnemonicToHDKey } from '@provablehq/veil-aleo-sdk'

const hdKey = mnemonicToHDKey(mnemonic, { index: 1 })
```

**Parameters**

- `mnemonic: string` — space-separated BIP-39 phrase.
- `options.index: number` — optional, defaults to `0`. Zero-based account
  index, below 2³¹.
- `options.derivation: 'standard' | 'legacy'` — optional, defaults to
  `'standard'` (`m/44'/683'`); `'legacy'` recovers accounts from wallets that
  predate the SLIP-0044 registration.

**Returns** `BLS12377HDKey` — the account node; its `key` bytes seed the
Aleo private key. Throws if the index is out of range.

## BLS12377HDKey

Hierarchical-deterministic key node for the BLS12-377 curve Aleo uses.
Follows the SLIP-0010 construction (HMAC-SHA512 chains, hardened-only
derivation) with an Aleo-specific master key tag. All operations are pure and
local. Most callers reach it only through `mnemonicToHDKey`; the static
factory and `derive`/`deriveChild` methods below apply when building custom
derivation paths.

```ts
import { BLS12377HDKey, mnemonicToSeed } from '@provablehq/veil-aleo-sdk'

const seed = mnemonicToSeed(mnemonic)
const root = BLS12377HDKey.fromMasterSeed(seed)
const account0 = root.derivePath("m/44'/683'").deriveChild(0)
```

### `BLS12377HDKey.fromMasterSeed(seed: Uint8Array)`

Derives the master node from a BIP-39 seed. Returns the root
`BLS12377HDKey` node paths are derived from.

### `derive(path: string)` / `derivePath(path: string)`

Derives the descendant node at a hardened path (`m/44'/683'` — every segment
MUST be hardened, trailing `'`, and below 2³¹). Returns a new node; the node
it is called on is unchanged. Throws if the path is malformed, contains a
non-hardened segment, or a segment is out of range. `derivePath` is an alias
kept for HD-key API parity.

### `deriveChild(index: number)`

Derives the account node at `m/{index}'/0'` relative to the node it is
called on. Applied to a `STANDARD_PATH`/`LEGACY_PATH` node, this yields the
account at that index. Throws if the index is negative, fractional, or 2³¹
or greater.

## STANDARD_PATH / LEGACY_PATH

`STANDARD_PATH` (`m/44'/683'`) is the SLIP-0044-registered Aleo coin type;
`LEGACY_PATH` (`m/44'/0'`) is the pre-registration path some older wallets
used. Both are plain string constants passed to `derive`/`derivePath`, and
both back the `'standard'`/`'legacy'` values of `AleoDerivationId` that
`mnemonicToAccount`, `generateMnemonicAccount`, and `mnemonicToHDKey` accept
directly.

```ts
import { STANDARD_PATH, LEGACY_PATH } from '@provablehq/veil-aleo-sdk'

STANDARD_PATH // "m/44'/683'"
LEGACY_PATH   // "m/44'/0'"
```
