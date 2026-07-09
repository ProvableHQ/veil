---
sidebar_position: 7
---

# verifySignature

Verifies a signature against a message and an address. Pure and local.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.generateAccount()

const message = new TextEncoder().encode('Hello from veil!')
const signature = await account.sign(message)

const verified = aleo.verifySignature(
  account.address,
  message,
  new TextDecoder().decode(signature),
)
// true
```

## Returns

`boolean`

`true` if `signature` is a valid signature of `message` by `address`'s
private key.

## Parameters

### address

- **Type:** `string`

Aleo address (`aleo1...`) the signature is checked against.

### message

- **Type:** `Uint8Array`

Message bytes that were signed.

### signature

- **Type:** `string`

Aleo signature (`sign1...`) to verify.
