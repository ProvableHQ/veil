---
sidebar_position: 3
---

# useVeilWallet

The hook a component calls to read chain state and interact with the
connected wallet. It returns a `publicClient` that works whether or not a
wallet is connected, and a `walletClient` that appears once one is. Must be
called under a `VeilProvider` — it reads the wallet context that provider
establishes.

## Usage

```tsx
import { useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

function App() {
  const { publicClient, walletClient, address, connect, disconnect } = useVeilWallet()
}
```

## Config

An optional config object overrides the defaults `useVeilWallet` otherwise
derives from the wallet context:

| Option | Type | Default | Description |
|---|---|---|---|
| `rpcUrl` | `string` | `'https://api.provable.com/v2'` | Node endpoint the `publicClient` reads through, and the `walletClient` falls back to if the wallet's own transport is unavailable. |
| `network` | `'mainnet' \| 'testnet'` | The connected wallet's network, or `'mainnet'` before one connects | Pins the transport to one network regardless of which network the wallet is on. |

```tsx
const { publicClient } = useVeilWallet({
  rpcUrl: 'https://custom-rpc.example.com',
  network: 'testnet',
})
```

## Return value

| Property | Type | Description |
|---|---|---|
| `publicClient` | `PublicClient` | Read-only client. Available immediately, with or without a connected wallet. |
| `walletClient` | `WalletClient \| undefined` | Write client that signs and submits through the connected wallet. `undefined` until a wallet connects. |
| `address` | `string \| null` | The connected account's address, or `null` when no wallet is connected. |
| `connected` | `boolean` | `true` once a wallet session is established and `walletClient` is available. |
| `connecting` | `boolean` | `true` while a `connect()` call is in flight. |
| `connect` | `(walletName?: string) => Promise<void>` | Opens the wallet's approval flow. Pass a wallet name to select and connect in one step; otherwise connects whichever wallet `selectWallet` chose. |
| `disconnect` | `() => Promise<void>` | Ends the wallet session. `walletClient` becomes `undefined` and `address` becomes `null`. |
| `wallets` | `Wallet[]` | Every wallet `VeilProvider` registered, each with its adapter and install (`readyState`) status — enough to build a wallet picker. |
| `selectWallet` | `(name: string) => void` | Chooses which wallet a later `connect()` (called without an argument) opens. |

### Before a wallet connects

Before any `connect()` resolves, `publicClient` is already usable —
reads never require a wallet. The rest of the state reflects "nothing
connected yet":

- `walletClient` is `undefined`. Gate every write on it (`if (walletClient) { ... }`), since calling a method on `undefined` throws.
- `address` is `null`.
- `connected` is `false`.
- `connecting` is `false`, unless a `connect()` call is currently in flight.
- `wallets` is already populated — wallet discovery does not require a connection, so a picker can render before the user connects anything.

### The connect flow

Two ways to drive `connect`, matching how `WalletButton` in the loyalty dApp
example uses it. Pass a wallet name straight to `connect` to select and
connect in one step:

```tsx
<button onClick={() => connect('Shield Wallet')}>Shield</button>
<button onClick={() => connect('Leo Wallet')}>Leo</button>
```

Or call `selectWallet` first — for example from a picker built off `wallets`
— then `connect` with no argument:

```tsx
selectWallet('Shield Wallet')
await connect()
```

`connect` always opens the wallet's approval flow on the wallet's current
network; it does not itself switch networks. `connecting` is `true` for the
duration of that flow, so a caller can disable the connect button while it
resolves. Once the user approves, `connected` becomes `true`, `address`
populates, and `walletClient` becomes available on the next render.

## Reading and writing

```tsx
// Reads — always work, connected or not.
const balance = await publicClient.getBalance({ address: 'aleo1...' })

// Writes — require a connected wallet.
if (walletClient) {
  const txId = await walletClient.writeContract({
    program: 'loyalty_token.aleo',
    function: 'add_points',
    inputs: [address!, '100u64'],
  })
}
```

`walletClient` bridges the connected adapter into a Veil `WalletClient`
through `@provablehq/veil-aleo-wallet-adapter` internally, so every action on
it — [`writeContract`](/api/wallet/writeContract), `requestRecords`,
`transactionStatus`, and the rest — behaves the same as it does for a
local-key account, with the wallet prompting the user in place of local
signing and proving. See [Working with
records](/guides/working-with-records) for fetching and spending records
through `walletClient.requestRecords`, and
[transactionStatus](/api/wallet/transactionStatus) for the status values a
submitted transaction can resolve to (`accepted`, `rejected`, `pending`,
`not_found`).
