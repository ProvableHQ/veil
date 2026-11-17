---
sidebar_position: 3
---

# privateKeyToAccount

Derives a `LocalAccount` from an existing Aleo private key: computes the
address and view key, and wires local `sign`/`signMessage` functions bound to
that key. Pure and local. Aleo keys do not depend on the network, so the
function is a top-level export and needs no network handle.

## Usage

```ts
import { privateKeyToAccount } from '@provablehq/veil-aleo-sdk'

const account = privateKeyToAccount('APrivateKey1...')
```

The same function is also a method on the handle that `loadNetwork()` returns:

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const account = aleo.privateKeyToAccount('APrivateKey1...')
```

## Returns

`LocalAccount<'privateKey'>`

The account derived from the key: `address`, `privateKey` (echoes the
input), `viewKey`, and `sign`/`signMessage` functions that sign a message
locally with the private key. `source` is `'privateKey'`.

## Parameters

### privateKey

- **Type:** `string`

Aleo private key (`APrivateKey1...`) to derive the account from.
