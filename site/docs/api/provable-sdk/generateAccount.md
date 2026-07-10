---
sidebar_position: 2
---

# generateAccount

Creates a new random Aleo account. Draws entropy from the platform CSPRNG and
runs entirely locally — nothing is sent over the network.

Key generation does not depend on which network's binaries are loaded, so
this is available two ways: a standalone export that needs no network setup,
and an equivalent method on the handle [`loadNetwork`](./loadNetwork)
returns. Both produce a `LocalAccount` in the same shape.

## Usage

```ts
import { generateAccount } from '@provablehq/veil-aleo-sdk'

const account = generateAccount()
// { type: 'local', source: 'privateKey', address: 'aleo1...', privateKey: 'APrivateKey1...', viewKey: 'AViewKey1...', sign, signMessage }
```

Equivalent, from a network handle:

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.generateAccount()
```

## Returns

`LocalAccount<'privateKey'>`

A local account: `address`, `privateKey`, `viewKey`, and a `sign`/
`signMessage` pair that signs locally with the generated key. `source` is
`'privateKey'`.
