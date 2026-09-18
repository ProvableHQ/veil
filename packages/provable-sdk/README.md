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
// for reads, and a wallet client with proving + the scanner attached.
const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://edge.provable.com/api/v2',
  records: scanner,
})

account.address // 'aleo1...'
```

No API key appears above: the hosted prover and scanner run on the Provable
gateway, which needs no credentials. A provisioned key, when an operator issues
one, goes through `auth` — see [Provable API access](#provable-api-access).

`proverUrl` is a base URL — the active network is appended, the same way the
record scanner's `url` works — so `switchChain` re-targets proving instead of
leaving it on the network the client started from. Do not include the network
segment yourself. It defaults to Provable's hosted prover
(`DEFAULT_PROVER_URL`) under delegated proving, so the option only needs setting
for a self-hosted one.

Pass `provingMode: 'local'` to prove in-process instead of delegating to a prover
service (drop `proverUrl`). The `walletClient` composes with
action packages the same way a wallet-backed client does:

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = walletClient.extend(
  shieldSwapActions({ api: {} }),
)
```

## Provable API access

The hosted prover and record scanner run on the Provable gateway,
`https://edge.provable.com/api`, and every default in this package points there.
The gateway is unauthenticated: a client built from nothing but a private key and
a network URL proves and scans. An operator may issue a provisioned API key; pass
it through `auth` and every request carries it in an `X-API-Key` header:

```ts
const { walletClient } = aleo.createAleoClient({
  privateKey,
  networkUrl: 'https://edge.provable.com/api/v2',
  records: aleo.createRemoteScanner(),
  auth: { mode: 'api-key', value: process.env.PROVABLE_API_KEY! },
})
```

A 401 under keyed auth means the key is invalid or revoked, which only the
operator can fix. `auth` is mutually exclusive with the consumer options below;
combining them throws at construction.

The legacy gateway, `https://api.provable.com`, authenticates with JWTs minted
from a consumer id and API key. That model is still supported for a caller who
points the client at it: set `proverUrl` (and the scanner `url`) to the legacy
gateway and pass `consumerId` and `apiKey` (or a `credentialStore` that holds
them), and one session mints the JWT at that gateway and hands it to proving and
scanning. The mint root is the origin of the prover URL, so a self-hosted legacy gateway
serving `/jwts` at its own origin works the same way. On the default gateway the pair
is carried and nothing mints, because edge has no JWT route:

```ts
const { walletClient } = aleo.createAleoClient({
  privateKey,
  networkUrl: 'https://api.provable.com/v2',
  proverUrl: 'https://api.provable.com/prove',
  records: aleo.createRemoteScanner({ url: 'https://api.provable.com/scanner' }),
  consumerId,
  apiKey,
})
const { expiration } = await walletClient.authenticateProvableApi() // mints eagerly
```

Consumer registration is retired: `registerProvableApi` is a no-op that resolves
`undefined`, `username` is ignored, and a client without a pair never registers
one. `authenticateProvableApi()` never throws for lack of credentials; on a
credential-less or keyed client it resolves with `credentials: undefined`,
`expiration: undefined`, and `registered: false`. `fileCredentialStore` and
`memoryCredentialStore` remain for a pair held on disk; a store is read once and
never written.

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
