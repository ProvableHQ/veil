---
sidebar_position: 2
---

# VeilProvider

`VeilProvider` wraps a React subtree with Aleo wallet connection support. It
registers the Shield, Leo, Puzzle, and Fox wallet adapters, tracks connection
state, and makes that state available to `useVeilWallet` calls anywhere
beneath it. A component under `VeilProvider` never imports a wallet adapter
directly.

## Usage

```tsx
import { VeilProvider } from '@provablehq/veil-aleo-react-hooks'

<VeilProvider
  network="testnet"
  programs={['loyalty_token.aleo', 'loyalty_rewards.aleo', 'credits.aleo']}
>
  <App />
</VeilProvider>
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `ReactNode` | — required | The subtree rendered with wallet context. |
| `network` | `'mainnet' \| 'testnet'` | `'mainnet'` | Network the wallet connects to and the `publicClient` inside `useVeilWallet` falls back to before a wallet connects. |
| `autoConnect` | `boolean` | `true` | Reconnects to the last-used wallet on page load, without a user gesture. |
| `decryptPermission` | `WalletDecryptPermission` | `UponRequest` | Level of record-decrypt access the wallet grants at connect time. |
| `programs` | `string[]` | `undefined` | Programs the dApp declares it will call, registered with the wallet at connect time. |
| `wallets` | `WalletAdapter[]` | all four known adapters | Overrides the wallet list `VeilProvider` registers. |
| `recordAccess` | `RecordAccessGrant` | `undefined` | Connect-time grant scoping which records and fields the dApp may read. |
| `readAddress` | `boolean` | `true` | Whether the dApp learns the connected address. |
| `algorithmsAllowed` | `AlgorithmGrant[]` | `undefined` | Allowlist authorizing `derived`-type transaction inputs at specific call sites. |

### `network`

Selects which Aleo network the wallet connects to. `VeilProvider` maps this to
the underlying `Network` enum the wallet adapters expect, so a consumer never
imports that enum directly.

### `autoConnect`

When `true`, `VeilProvider` attempts to reconnect the previously connected
wallet as soon as the app mounts, without waiting for the user to click a
connect button. Set `false` to require an explicit `connect()` call every
session — useful for flows that must not silently resume a prior session.

### `decryptPermission`

One of the four levels defined by `WalletDecryptPermission` in
`@provablehq/aleo-wallet-standard`:

- `NoDecrypt` — the wallet decrypts nothing for the dApp.
- `UponRequest` (default) — the wallet decrypts a record only when the dApp
  explicitly asks for it, e.g. through `requestRecords`.
- `AutoDecrypt` — the wallet decrypts any record the dApp requests without a
  separate approval step per request.
- `OnChainHistory` — the wallet additionally exposes on-chain transaction
  history for the declared `programs`.

Raising the permission level trades a wallet prompt for convenience; pick the
lowest level the app's record access actually needs.

### `programs`

Lists the program ids the dApp calls, declared once at connect time rather
than per transaction. Wallets that gate execution by an allowlist — Shield is
one — reject calls against a program missing from this list. Every program a
`writeContract` or `requestRecords` call touches belongs here, including
`credits.aleo` if the app spends or checks credits records alongside its own
programs:

```tsx
<VeilProvider
  network="testnet"
  programs={['loyalty_token.aleo', 'loyalty_rewards.aleo', 'credits.aleo']}
>
  <App />
</VeilProvider>
```

### `wallets`

Replaces the default wallet list with an array of `WalletAdapter` instances
(the pre-connect adapter interface from `@provablehq/aleo-wallet-standard`,
distinct from the post-connect `AleoWalletAdapter` Veil bridges internally).
Omitted, `VeilProvider` registers
`ShieldWalletAdapter`, `LeoWalletAdapter`, `PuzzleWalletAdapter`, and
`FoxWalletAdapter` — every wallet Veil currently knows how to construct. Pass
an explicit array to narrow that list, for example when a dApp supports only
one wallet:

```tsx
import { VeilProvider } from '@provablehq/veil-aleo-react-hooks'
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield'

<VeilProvider wallets={[new ShieldWalletAdapter()]}>
  <App />
</VeilProvider>
```

### `recordAccess`

Scopes which records and fields of the declared `programs` the dApp may read,
on wallets that honor the grant (Shield does; wallets without support ignore
it). Two shapes: deny all record access, or grant it program by program:

```tsx
<VeilProvider
  recordAccess={{
    level: 'byProgram',
    programs: [
      { program: 'credits.aleo', records: [{ recordname: 'credits' }] },
    ],
  }}
>
  <App />
</VeilProvider>
```

Omitting a `records` entry for a program grants every record of that program;
omitting `fields` within a record grant grants every field of that record.

### `readAddress`

Controls whether the dApp learns the connected address at all. `false`
transacts without the dApp ever receiving `aleo1...` — every input the
account would normally supply is instead requested from the wallet as an
`{ type: 'address' }` input. This only takes effect paired with
`decryptPermission: 'NoDecrypt'`; combined with a higher decrypt permission
the wallet has no way to withhold the address consistently and the option has
no effect.

### `algorithmsAllowed`

An allowlist of wallet-side derivations the dApp may request as `derived`
transaction inputs — values the wallet computes from its own private state
(a blinding factor, a blinded address) rather than a value the dApp supplies.
Each grant authorizes one `(algorithm, program, function, inputPosition)`
call site; omitted, every `derived` input the dApp requests is refused:

```tsx
<VeilProvider
  algorithmsAllowed={[
    {
      algorithm: 'program-scoped-blinded-address',
      program: 'shield_swap_v3.aleo',
      function: 'swap',
      inputPosition: 0,
    },
  ]}
>
  <App />
</VeilProvider>
```
