---
sidebar_position: 5
---

# @provablehq/veil-aleo-react-hooks

React bindings for Veil. A batteries-included provider auto-configures the known
Aleo adapters (Shield, Leo, Puzzle, Fox), and a hook returns ready-to-use
clients — add wallet connection and chain access without wiring adapters by hand.

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-react-hooks
```

## Key exports

- **`VeilProvider`** — wraps your app and configures wallets.
- **`useVeilWallet()`** — returns `publicClient`, `walletClient`, `address`, `connected`, `connecting`, `connect`, `disconnect`, `wallets`, `selectWallet`.

## Usage

```tsx
import { VeilProvider, useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

function Root() {
  return (
    <VeilProvider network="mainnet">
      <App />
    </VeilProvider>
  )
}

function App() {
  const { publicClient, walletClient, address, connect } = useVeilWallet()
  // …
}
```

See the [React](../react/overview) section for the full provider and hook API.
