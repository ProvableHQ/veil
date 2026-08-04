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
})

// A fully-wired client pair: an account from the private key, a public client
// for reads, and a wallet client with proving + the scanner attached. The
// credentials build one Provable API session shared by proving and scanning.
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

## Provable API credentials

Delegated proving and the hosted record scanner both authenticate with a consumer
id and API key, which the SDK exchanges for short-lived JWTs. Passing the pair to
`createAleoClient` builds a single session that covers both services, so one
credential mints one token instead of each service minting its own.

If you already hold credentials, the example above is all you need — the session
resolves on the first prove or scan. `authenticateProvableApi()` does it eagerly,
which is worth doing at startup so a bad key fails before you have built a
transaction:

```ts
const { credentials, expiration, registered, applied } =
  await walletClient.authenticateProvableApi()

applied // { proving: true, recordScanning: true }
```

`applied` reports which paths the session actually reaches. `recordScanning` is
`false` when the client was given a record provider it cannot share a session
with — any implementation other than the ones this package builds — in which case
that provider keeps using whatever credentials it was constructed with.

If you do not have credentials yet, register a consumer once. The API key is
issued exactly once and cannot be recovered, so persist it immediately:

```ts
import { registerProvableApi } from '@provablehq/veil-aleo-sdk'

const credentials = await registerProvableApi({ username: 'my-bot-42' })
await writeFile('creds.json', JSON.stringify(credentials), { mode: 0o600 })
```

Usernames are globally unique across the Provable API, so a taken name fails the
call and needs a different one.

For a process that should register on first run and reuse the same consumer
afterward, hand the client a `credentialStore` instead of a credential pair. The
SDK reads through it, registers only when it comes back empty, and writes the new
credentials back before returning. Persistence is yours to implement — a file, a
keychain, `localStorage`, and a secret manager are all valid, and the SDK makes no
assumption about which:

```ts
import type { ProvableCredentialStore } from '@provablehq/veil-aleo-sdk'

const credentialStore: ProvableCredentialStore = {
  load: async () => JSON.parse(await readFile(path, 'utf8')).provableApi,
  save: async (c) =>
    writeFile(path, JSON.stringify({ provableApi: c }), { mode: 0o600 }),
}

const { walletClient } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  proverUrl: 'https://api.provable.com/prove/testnet',
  credentialStore,
  records: scanner,
})

const { registered } = await walletClient.authenticateProvableApi()
registered // true on the first run, false afterward
```

An explicit `consumerId`/`apiKey` pair takes precedence over the store, so an
operator can inject a rotated key or CI credentials without clearing persisted
state first.

One caveat on the mint itself: the API does not validate the consumer id against
the API key. A mismatched id still yields a working token, because the token's
issuer comes from the key. The mismatch surfaces later as a rejection from the
service you call — the record scanner reports it as `No credentials found for
given 'iss'`. Nothing in the mint path can catch that for you, so keep the pair
together.

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
