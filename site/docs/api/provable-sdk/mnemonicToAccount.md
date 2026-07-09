---
sidebar_position: 4
---

# mnemonicToAccount

Derives a `LocalAccount` from a BIP-39 mnemonic phrase using Aleo's
BLS12-377 HD derivation — the same derivation Shield wallet uses, so a
mnemonic imported from Shield reproduces the same address. Pure and local.

Defaults to the SLIP-0044-registered Aleo coin type path `m/44'/683'` at
account index 0. Pass `derivation: 'legacy'` to derive under the
pre-registration path `m/44'/0'` instead, for recovering accounts created by
wallets that predate the SLIP-0044 registration.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const account = aleo.mnemonicToAccount(
  'absurd letter switch already canoe piano wage sock unique all blade coyote',
)
// account.address === 'aleo132x69f77mz7cx2f4s5wykktj73tj8cy7smdvxrgwja9qcmyuysxst42d9m'
```

## Returns

`LocalAccount<'mnemonic'>`

The account derived from the phrase, in the same shape as
[`privateKeyToAccount`](./privateKeyToAccount)'s return, with `source` set to
`'mnemonic'`.

## Parameters

### mnemonic

- **Type:** `string`

Space-separated BIP-39 phrase.

### options.index

- **Type:** `number`
- **Default:** `0`

Zero-based account index on the derivation path.

### options.derivation

- **Type:** `'standard' | 'legacy'`
- **Default:** `'standard'`

Derivation path convention. `'standard'` uses `m/44'/683'`; `'legacy'` uses
the pre-registration path `m/44'/0'`.
