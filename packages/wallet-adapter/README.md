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
pnpm add @provablehq/aleo-wallet-adapter-core   # base adapter class
pnpm add @provablehq/aleo-wallet-adapter-leo    # e.g. Leo
```

`@provablehq/aleo-wallet-adapter-core` is an optional peer, so nothing in this
package statically imports it — `fromWalletAdapter` works on any object matching
the adapter shape.

## Usage

Connect a wallet adapter, then hand it to `fromWalletAdapter` to get a Veil
`account` and `transport`. The transport handles wallet operations
(`executeTransaction`, `decrypt`, `requestRecords`, …); pair it with `http()`
through `fallback()` so read methods (`getBlock`, `getBalance`) still resolve.

```ts
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adapter-leo'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { createWalletClient, http, fallback } from '@provablehq/veil-core'

const wallet = new LeoWalletAdapter()
await wallet.connect(network, decryptPermission)

const { account, transport } = fromWalletAdapter(wallet)

const client = createWalletClient({
  account,
  transport: fallback([transport, http('https://edge.provable.com/api/v2')]),
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

## Freezelist proofs inside the wallet

The adapter forwards `freezelistProofRequest(...)` inputs from `veil-core`
unchanged, including proofs that fill an array slot. The connected wallet must
implement `program-freezelist-exclusion-proof` and authorize each proof slot
through its connection's `algorithmsAllowed` grants. Build those grants with
`freezelistProofGrant({ program, function, inputPosition, freezelistProgram })`.
The grant restricts the list to the program whose root the target contract checks.

Check `await wallet.algorithmsSupported()` for `FREEZELIST_PROOF_ALGORITHM`
before enabling wallet proof selection. Capability responses come from the
adapter and still depend on the installed wallet implementing the resolver.
An unsupported algorithm, missing grant, or frozen subject rejects execution;
Veil preserves the wallet error. Do not replace such a failure with an empty proof.

The optional request `address` selects an explicit proof subject; omitting it
uses the wallet signer. For a hidden withdrawal address inside a wallet-owned
record, the caller must obtain the actual subject or use a flow that can resolve
it; substituting the signer is not sufficient. Local-key clients continue to
use encoded proofs. See the [core example](../core/README.md#wallet-generated-freezelist-proofs)
for an explicit record and proof transfer.

## Where this fits

Most React apps use `@provablehq/veil-aleo-react-hooks` and its `VeilProvider`, which wraps this
package and manages connection state for the caller. `@provablehq/veil-aleo-wallet-adapter` is
the framework-agnostic layer underneath — reach for it directly in scripts,
non-React apps, or when building a custom provider.
