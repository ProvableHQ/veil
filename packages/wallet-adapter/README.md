# @provablehq/veil-aleo-wallet-adapter

Adapts a Provable/Aleo wallet-standard adapter (Shield, Leo, Puzzle, Fox, …) into
the abstract `@provablehq/veil-core` account and transport interfaces.

Reach for this when a connected wallet — not the app — should hold the keys and
records and prove transactions. The adapter keeps signing, decryption, record
lookup, and proving inside the wallet, so the app carries no key material. It
turns any standard-conforming adapter into the `account` and `transport` a Veil
client is built from.

## Installation

```sh
pnpm add @provablehq/veil-aleo-wallet-adapter @provablehq/veil-core
```

The concrete wallet adapter packages are optional peers — install only the ones
for the wallets a developer supports:

```sh
pnpm add @provablehq/aleo-wallet-adaptor-core   # base adapter class
pnpm add @provablehq/aleo-wallet-adaptor-leo    # e.g. Leo
```

`@provablehq/aleo-wallet-adaptor-core` is an optional peer, so nothing in this
package statically imports it — `fromWalletAdapter` works on any object matching
the adapter shape.

## Usage

Connect a wallet adapter, then hand it to `fromWalletAdapter` to get a Veil
`account` and `transport`. The transport handles wallet operations
(`executeTransaction`, `decrypt`, `requestRecords`, …); pair it with `http()`
through `fallback()` so read methods (`getBlock`, `getBalance`) still resolve.

```ts
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { createWalletClient, http, fallback } from '@provablehq/veil-core'

const wallet = new LeoWalletAdapter()
await wallet.connect(network, decryptPermission)

const { account, transport } = fromWalletAdapter(wallet)

const client = createWalletClient({
  account,
  transport: fallback([transport, http('https://api.provable.com/v2')]),
})
```

`fromWalletAdapter` is the primary entry point. It composes the two lower-level
helpers, `rpcAccountFromAdapter` and `transportFromAdapter`, which are exported
if a caller needs the account or transport on its own. The adapter must already
be connected — the account throws otherwise.

The package also exports the `AleoWalletAdapter` interface (the post-connect
method subset Veil invokes), the `AnyWalletAdapter` union (that interface or the
upstream `BaseAleoWalletAdapter`), and the privacy-feature types
(`InputRequest`, `RecordFilters`, `ConnectOptions`, `RecordAccessGrant`,
`AlgorithmGrant`, …) so a call site can import them alongside `fromWalletAdapter`.

## Where this fits

Most React apps use `@provablehq/veil-aleo-react-hooks` and its `VeilProvider`, which wraps this
package and manages connection state for the caller. `@provablehq/veil-aleo-wallet-adapter` is
the framework-agnostic layer underneath — reach for it directly in scripts,
non-React apps, or when building a custom provider.
