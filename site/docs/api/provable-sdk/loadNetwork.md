---
sidebar_position: 1
---

# loadNetwork

Loads the WASM binaries from `@provablehq/sdk` for one Aleo network and
returns a network-bound handle (`AleoSdk`) exposing key and account
derivation, proving configuration, and record scanning. The SDK module cache
memoizes the load, so calling `loadNetwork` twice for the same network reuses
the same binary set instead of re-instantiating it.

Most of the handle's key and account operations (`privateKeyToAccount`,
`mnemonicToAccount`, `generateAccount`, `decryptRecord`, `verifySignature`)
are mathematically network-agnostic — the same private key or mnemonic
derives the same address and view key regardless of which network's binary
was loaded. Proving and client-building operations (`createProvingConfig`,
`createAleoClient`, the scanner factories) are network-bound: they target the
network passed to `loadNetwork`. Switching networks means loading a new
handle; accounts derived under the previous handle remain valid under the
new one.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const account = aleo.privateKeyToAccount('APrivateKey1...')
```

## Returns

`Promise<AleoSdk>`

A handle bound to the named network, exposing `network` (the name passed in)
plus the account, proving, and scanner methods documented on their own pages
under this section.

## Parameters

### name

- **Type:** `'mainnet' | 'testnet'`

Network whose WASM binaries to load.
