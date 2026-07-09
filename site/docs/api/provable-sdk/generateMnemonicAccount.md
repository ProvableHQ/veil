---
sidebar_position: 5
---

# generateMnemonicAccount

Generates a fresh BIP-39 mnemonic and derives its Aleo account in one call.
Pure and local — no network access. The caller MUST persist the returned
mnemonic; it is the only way to re-derive the account later.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const { mnemonic, account } = aleo.generateMnemonicAccount()
// store `mnemonic` safely; `account.address` is ready to use
```

## Returns

`{ mnemonic: string; account: LocalAccount<'mnemonic'> }`

`mnemonic` is the generated BIP-39 phrase. `account` is the account derived
from it, in the same shape [`mnemonicToAccount`](./mnemonicToAccount)
returns.

## Parameters

### options.strength

- **Type:** `128 | 256`
- **Default:** `128`

Entropy in bits for the generated phrase: 128 yields 12 words, 256 yields
24.

### options.index

- **Type:** `number`
- **Default:** `0`

Account index on the derivation path.

### options.derivation

- **Type:** `'standard' | 'legacy'`
- **Default:** `'standard'`

Derivation path id: `'standard'` uses `m/44'/683'`; `'legacy'` uses the
pre-registration path `m/44'/0'`.
