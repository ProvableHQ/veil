---
sidebar_position: 3
---

# @provablehq/veil-aleo-sdk

Wraps `@provablehq/sdk` (the Provable WASM SDK) and binds it to a named
network. Applies when the code holds a private key directly and must sign and
prove locally or via delegated proving — a bot, script, server, or CI job.
It builds a fully-wired client from a private key, derives accounts from keys
or BIP39 mnemonics, and configures record scanning. It is the headless,
server-side counterpart to `@provablehq/veil-aleo-wallet-adapter`.

## Installation

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-sdk
```

## Key exports

- **`loadNetwork(name)`** — the entry point; asynchronously loads the WASM binaries for `'mainnet'` or `'testnet'` and returns a network-bound `AleoSdk` handle.
- **`AleoSdk` methods** — `createAleoClient`, `privateKeyToAccount`, `mnemonicToAccount`, `generateMnemonicAccount`, `generateAccount`, `createProvingConfig`, `createNetworkClient`, `createRemoteScanner`, `createStandaloneScanner`, `decryptRecord`, `verifySignature`.
- **Standalone** — `generateAccount` (uses statically-loaded testnet binaries; no `loadNetwork` call needed), `createDevnodeClient` (zero-config client pointed at a local devnode).
- **Mnemonic / HD** — `generateMnemonic`, `validateMnemonic`, `mnemonicToHDKey`, `STANDARD_PATH`, `LEGACY_PATH`.

Key and mnemonic operations are mathematically network-agnostic — the same
private key or mnemonic derives the same address and view key regardless of
which network's binary set is loaded. Proving and program operations
(`createProvingConfig`, `createAleoClient`, the scanners) are network-bound to
the handle that created them.

## Example

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('mainnet')

const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated', // or 'local'
})
```

`createAleoClient` also accepts a `records` provider (`aleo.createRemoteScanner(...)`)
for actions that spend private records — without one, `requestRecords` throws
with a setup hint. Switching networks means loading a new handle; existing
accounts remain valid since keys and addresses don't depend on which binary
set produced them.

See the [`/api/provable-sdk`](/api/provable-sdk/loadNetwork) pages for every
method's parameters and defaults, and
[Executing transactions](/guides/executing-transactions) for the proving
config in context.
