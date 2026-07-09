---
sidebar_position: 6
---

# decryptRecord

Decrypts a record ciphertext using a view key. Pure and local — the view key
never leaves the caller and no network round trip is made.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const plaintext = aleo.decryptRecord(
  account.viewKey,
  'record1qyqsq...ciphertext...',
)
```

## Returns

`string`

The decrypted record plaintext, in Aleo's record literal format
(`{owner: aleo1..., ...}`).

## Parameters

### viewKey

- **Type:** `string`

Aleo view key (`AViewKey1...`) that owns the record.

### ciphertext

- **Type:** `string`

Record ciphertext (`record1...`) to decrypt.
