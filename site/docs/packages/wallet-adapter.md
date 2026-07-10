---
sidebar_position: 4
---

# @provablehq/veil-aleo-wallet-adapter

Adapts any Provable-standard Aleo wallet (Shield, Leo, Puzzle, Fox) into
Veil's `Account` and `Transport` interfaces, so a `@provablehq/veil-core`
wallet client can be built from an already-connected adapter — the app never
holds a private key. Applies to framework-agnostic code; React apps use
`@provablehq/veil-aleo-react-hooks`, which wraps this package.

## Installation

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-wallet-adapter
```

## Key exports

- **`fromWalletAdapter(adapter)`** — the primary entry point; returns `{ account, transport }`.
- `rpcAccountFromAdapter`, `transportFromAdapter` — the individual pieces `fromWalletAdapter` composes.
- Re-exported types: `ConnectOptions`, `InputRequest`, `RecordFilters`, `RecordView`, `AlgorithmGrant`, `RecordAccessGrant`, `Network`, `TransactionStatusResponse`, `TxHistoryResult`.

## Example

```ts
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { createWalletClient, http, fallback } from '@provablehq/veil-core'

const wallet = new LeoWalletAdapter()
await wallet.connect(Network.MAINNET, DecryptPermission.UponRequest)

const { account, transport } = fromWalletAdapter(wallet)
const walletClient = createWalletClient({
  account,
  // The adapter transport routes wallet operations (sign, execute, decrypt, …);
  // pair it with http() so reads (getBlock, getBalance, …) still resolve.
  transport: fallback([transport, http('https://api.provable.com/v2', { network: 'mainnet' })]),
})
```

The adapter transport only handles wallet-specific methods — read methods
fall through to the `http()` transport in the `fallback` chain. See
[Wallet client](/clients/wallet-client) for the full client surface.
