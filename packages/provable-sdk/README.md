# @provablehq/veil-aleo-sdk

Local signing and proving for the Veil Aleo SDK, backed by the Provable WASM SDK
(`@provablehq/sdk`).

Reach for this package when the caller holds an Aleo private key directly — bots,
scripts, tests, and CI — rather than connecting a wallet. It turns a private key
into an account, wires a wallet client with proving configured (delegated or
local), builds record scanners, and derives the same account keys (address, view
key) and blinded claim identity that private flows depend on. Because it loads
WASM, an app that connects a wallet instead — the wallet holds the keys and
proves for you — generally does not need this package at all.

## Installation

```sh
pnpm add @provablehq/veil-aleo-sdk @provablehq/veil-core
```

## Usage

Load the SDK for a network, then build the account, scanner, and clients from
the returned handle. `loadNetwork` is async because it fetches the network's WASM
binaries; the handle it returns is synchronous from there on.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

// A record scanner so the wallet client can find the private records that
// program calls spend. The first requestRecords registers the view key with the
// service (one network round-trip); later calls reuse it.
const scanner = aleo.createRemoteScanner({
  url: 'https://api.provable.com/scanner',
  consumerId: CONSUMER_ID,
  apiKey: DPS_API_KEY, // authenticates + registers the view key for scanning
})

// A fully-wired client pair: an account from the private key, a public client
// for reads, and a wallet client with proving + the scanner attached.
const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated',
  proverUrl: 'https://api.provable.com/prove/testnet',
  apiKey: DPS_API_KEY,
  consumerId: CONSUMER_ID,
  records: scanner,
})

account.address // 'aleo1...'
```

Pass `provingMode: 'local'` to prove in-process instead of delegating to a prover
service (drop `proverUrl`/`apiKey`/`consumerId`). The `walletClient` composes with
action packages the same way a wallet-backed client does:

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = walletClient.extend(
  shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }),
)
```

The handle also exposes the pieces individually when the caller does not want the
full pair:

- `aleo.privateKeyToAccount(privateKey)` / `aleo.mnemonicToAccount(mnemonic)` /
  `aleo.generateAccount()` — build a `LocalAccount`.
- `aleo.createProvingConfig({ ... })` — the `proving` config for
  `createWalletClient({ proving })`.
- `aleo.createStandaloneScanner({ ... })` — a scanner keyed by an explicit view
  key, with no account attached.
- `aleo.decryptRecord(viewKey, ciphertext)` / `aleo.verifySignature(...)` —
  network-agnostic key operations.

For local iteration without a live chain, `createDevnodeClient()` returns the
same client pair pointed at an Aleo Devnode instance with a pre-funded seeded
account.

## WASM dependency

`@provablehq/sdk` ships the Aleo cryptography as WebAssembly, and this package
loads it. That is the cost of holding keys and proving locally. An app that
connects a wallet — Shield, Leo — should build its client from the wallet adapter
instead (see `@provablehq/veil-aleo-wallet-adapter`) and skip `@provablehq/veil-aleo-sdk`, keeping the
WASM out of the bundle.
