---
sidebar_position: 3
---

# @veil/provable-sdk

Wraps the `@provablehq/sdk` (WASM) and binds it to a named network. Reach for it
to build a fully-wired client from a private key, derive accounts from keys or
BIP39 mnemonics, run local or delegated proving, and scan records — the
headless / server-side counterpart to `@veil/wallet-adapter`.

```bash
npm install @veil/core @veil/provable-sdk
```

## Key exports

- **`loadNetwork(name)`** — the entry point; returns a network-bound `AleoSdk` handle.
- **`AleoSdk` methods** — `createAleoClient`, `privateKeyToAccount`, `mnemonicToAccount`, `generateAccount`, `createProvingConfig`, `createRemoteScanner`, `createStandaloneScanner`, `decryptRecord`, `verifySignature`.
- **Mnemonic / HD** — `generateMnemonic`, `validateMnemonic`, `mnemonicToHDKey`, `STANDARD_PATH`, `LEGACY_PATH`.

## Usage

```ts
import { loadNetwork } from '@veil/provable-sdk'

const aleo = await loadNetwork('mainnet')

const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated', // or 'local'
})
```

`createAleoClient` also accepts a record scanner (`createRemoteScanner`) for
actions that spend private records. The WASM SDK is loaded lazily per network.
