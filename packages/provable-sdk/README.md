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

// A fully-wired client pair: an account from the private key, a public client
// for reads, and a wallet client with delegated proving and a record scanner
// attached. Every service defaults to the Provable gateway.
const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
})

account.address // 'aleo1...'
```

No URL or API key appears above: the node API, the hosted prover, and the
record scanner all run on the Provable gateway, which needs no credentials.
`networkUrl` defaults to `DEFAULT_NETWORK_URL`, `proverUrl` to
`DEFAULT_PROVER_URL`, and `records` to `aleo.createRemoteScanner()` against
`DEFAULT_SCANNER_URL`; each is an option for a self-hosted or legacy service.
The prover pays fees from its FeeMaster account by default (`useFeeMaster:
true`), so a faucet-funded account with no public credits can write; pass
`useFeeMaster: false` when the account funds its own fees. A provisioned key,
when an operator issues one, goes through `auth` — see
[Provable API access](#provable-api-access).

`networkUrl`, `proverUrl`, and the scanner's `url` are base URLs — the active
network is appended — so `switchChain` re-targets reads, proving, and scanning
instead of leaving them on the network the client started from. Do not include
the network segment yourself.

Pass `provingMode: 'local'` to prove in-process instead of delegating to a prover
service. The `walletClient` composes with
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
