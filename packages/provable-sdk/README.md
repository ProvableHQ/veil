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
// `url` defaults to Provable's hosted scanner, so this needs no arguments.
const scanner = aleo.createRemoteScanner()

// A fully-wired client pair: an account from the private key, a public client
// for reads, and a wallet client with proving + the scanner attached. The
// credential store holds one Provable API session shared by proving and
// scanning — it registers a consumer on the first run and reuses it after.
import { fileCredentialStore } from '@provablehq/veil-aleo-sdk/node'

const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  credentialStore: fileCredentialStore('./.provable-credentials.json'),
  records: scanner,
})

account.address // 'aleo1...'
```

No API key appears above: the store registers a Provable API consumer the first
time something needs one and reuses it from then on. Already hold credentials?
Pass `consumerId` and `apiKey` instead and drop the store — see
[Provable API credentials](#provable-api-credentials).

`proverUrl` is a base URL — the active network is appended, the same way the
record scanner's `url` works — so `switchChain` re-targets proving instead of
leaving it on the network the client started from. Do not include the network
segment yourself. It defaults to Provable's hosted prover
(`DEFAULT_PROVER_URL`) under delegated proving, so the option only needs setting
for a self-hosted one.

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
id and API key, which the SDK exchanges for short-lived JWTs. A client builds a
single session covering both services, so one credential mints one token instead
of each service minting its own.

Where that credential comes from is the only decision. Three options:

| | Use when | Registers? |
| --- | --- | --- |
| `fileCredentialStore(path)` from `/node` | Bots, scripts, servers, CI that can write to disk | On first run, then reuses |
| `consumerId` + `apiKey` | You already hold credentials — from a secret manager or env | Never |
| `memoryCredentialStore()` (the default) | Tests, ephemeral workers | Every process, key discarded at exit |

`memoryCredentialStore()` is what a client falls back to when given neither, so
delegated proving works with no configuration at all. It is only appropriate for
a single short run: the API issues each key exactly once, so a process that
registers into memory and runs again registers a second consumer nobody can
reclaim. Anything long-lived wants a persistent store.

The session resolves on the first prove or scan. `authenticateProvableApi()` does
it eagerly, which is worth doing at startup so a bad key fails before you have
built a transaction:

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

A username is spent once. It is globally unique, the API exposes no endpoint that
reads a consumer back, and a duplicate registration answers 409 with nothing
usable in it — so a taken name cannot be traded for the credentials it belongs to.
The stored key is the only copy, which is the real reason to give a client a
persistent store rather than the in-memory default.

When a client registers for you, `username` chooses the name:

```ts
const { walletClient } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  proverUrl: 'https://api.provable.com/prove',
  credentialStore: fileCredentialStore('./.provable-credentials.json'),
  username: 'my-bot-42',        // or () => `bot-${shard}`, resolved at registration
})
```

Supplied names are used verbatim, so the consumer is identifiable in your account
— and a collision fails with an error saying the name is taken rather than quietly
registering something else. Omit it and the name is derived from the account
address with a random suffix, which keeps the zero-configuration path working:
since a username cannot be reused, an account that lost its stored key still needs
to be able to register.

On Node, `fileCredentialStore` covers this. It writes with mode `0600`, treats a
missing file as "not registered yet", and reports a corrupt one rather than
registering over credentials that might still be recoverable by hand. It lives on
the `/node` subpath so the `node:fs` import never reaches a browser bundle:

```ts
import { fileCredentialStore } from '@provablehq/veil-aleo-sdk/node'

const { walletClient } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  proverUrl: 'https://api.provable.com/prove',
  credentialStore: fileCredentialStore('./.provable-credentials.json'),
  records: scanner,
})

const { registered } = await walletClient.authenticateProvableApi()
registered // true on the first run, false afterward
```

Anywhere else, implement the two-method interface yourself — a keychain,
`localStorage`, IndexedDB, or a secret manager all satisfy it, and the SDK assumes
nothing about which:

```ts
import type { ProvableCredentialStore } from '@provablehq/veil-aleo-sdk'

const credentialStore: ProvableCredentialStore = {
  load: () => {
    const raw = localStorage.getItem('provable-credentials')
    return raw ? JSON.parse(raw) : undefined // undefined → register
  },
  save: (c) => localStorage.setItem('provable-credentials', JSON.stringify(c)),
}
```

Two rules for a hand-written store. `load` MUST return `undefined` rather than
throw when nothing is stored, or resolution fails instead of registering. And
`save` must actually persist: it runs before the credentials are handed back
precisely so a failed write fails the call, since a swallowed one orphans a
consumer whose key cannot be reissued. That also means a genuinely read-only
environment should supply `consumerId`/`apiKey` directly rather than rely on
registration.

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
