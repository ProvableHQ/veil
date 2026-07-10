---
sidebar_position: 3
---

# privateKeyToAccount

Derives a `LocalAccount` from an existing Aleo private key: computes the
address and view key, and wires local `sign`/`signMessage` functions bound to
that key. Pure and local — mathematically network-agnostic, though it is
reached through a network handle.

## Usage

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
