---
sidebar_position: 5
---

# @provablehq/veil-aleo-react-hooks

React bindings for Veil. A batteries-included provider auto-configures the
known Aleo wallet adapters (Shield, Leo, Puzzle, Fox), and a hook returns
ready-to-use clients — wallet connection and chain access without wiring
adapters by hand. Applies to React apps; framework-agnostic code uses
`@provablehq/veil-aleo-wallet-adapter` directly.

## Installation

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-react-hooks
```

## Key exports

- **`VeilProvider`** — wraps the app tree and configures wallets. Props include `network` (defaults to `'mainnet'`), `autoConnect` (defaults to `true`), `decryptPermission`, `programs`, a `wallets` override, and the privacy-preserving connect options `recordAccess`, `readAddress`, and `algorithmsAllowed`.
- **`useVeilWallet(config?)`** — returns `publicClient`, `walletClient`, `address`, `connected`, `connecting`, `connect`, `disconnect`, `wallets`, `selectWallet`. `config.rpcUrl` overrides the node endpoint (defaults to the Provable API); `config.network` pins the transport's network instead of following the connected wallet.

## Example

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

  // publicClient works before a wallet connects; walletClient is
  // undefined until connect() resolves.
  return address ? <p>{address}</p> : <button onClick={() => connect()}>Connect</button>
}
```

See [React overview](/react/overview), [`VeilProvider`](/react/veil-provider),
and [`useVeilWallet`](/react/use-veil-wallet) for the full provider and hook
API.
