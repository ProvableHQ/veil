---
sidebar_position: 4
---

# @veil/wallet-adapter

Adapts any Provable-standard Aleo wallet (Shield, Leo, Puzzle, Fox) into Veil's
`Account` and `Transport`, so you can build a `@veil/core` wallet client from an
already-connected adapter — the app never holds a private key.

```bash
npm install @veil/core @veil/wallet-adapter
```

## Key exports

- **`fromWalletAdapter(adapter)`** — the entry point; returns `{ account, transport }`.
- `rpcAccountFromAdapter`, `transportFromAdapter` — the individual pieces.
- Re-exported types: `ConnectOptions`, `InputRequest`, `RecordFilters`, `AlgorithmGrant`, `Network`, …

## Usage

```ts
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
import { fromWalletAdapter } from '@veil/wallet-adapter'
import { createWalletClient, http, fallback } from '@veil/core'

const wallet = new LeoWalletAdapter()
await wallet.connect(Network.MAINNET, DecryptPermission.UponRequest)

const { account, transport } = fromWalletAdapter(wallet)
const walletClient = createWalletClient({
  account,
  // The adapter transport routes wallet ops; pair it with http() for reads.
  transport: fallback([transport, http('https://api.provable.com/v2')]),
})
```

For React apps, `@veil/react` wires this up automatically.
