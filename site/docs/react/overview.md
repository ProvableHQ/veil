---
sidebar_position: 1
---

# React Integration

`@provablehq/veil-aleo-react-hooks` is the browser-dApp layer of Veil. It pairs a
`VeilProvider` component with a `useVeilWallet` hook, giving a React app wallet
connection, a read-only client, and a write client through connected-wallet
signing — without wiring `@provablehq/veil-aleo-wallet-adapter` by hand.

The package builds on two lower layers a developer can also use directly:
`@provablehq/veil-core` for the client shapes (`PublicClient`, `WalletClient`)
and `@provablehq/veil-aleo-wallet-adapter` for turning a connected Aleo wallet
adapter into a Veil account. `@provablehq/veil-aleo-react-hooks` exists so a
React app does not have to assemble those pieces itself: it ships every known
Aleo wallet adapter (Shield, Leo, Puzzle, Fox) pre-registered, tracks
connection state as React state, and rebuilds the wallet client whenever the
connected account changes.

## Installation

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-react-hooks
```

## Provider at the root

`VeilProvider` wraps the part of the tree that needs wallet access — typically
the whole app. It renders children unchanged and makes wallet state available
to every hook call beneath it:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { VeilProvider } from '@provablehq/veil-aleo-react-hooks'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VeilProvider
      network="testnet"
      programs={['loyalty_rewards.aleo', 'loyalty_token.aleo', 'credits.aleo']}
    >
      <App />
    </VeilProvider>
  </StrictMode>,
)
```

`programs` declares which programs the dApp calls, up front, at connection
time. Wallets that gate execution by program allowlist (Shield does) need this
list before they will approve a transaction against those programs. See
[VeilProvider](/react/veil-provider) for every prop and its default.

## Hook in any component

`useVeilWallet` is the point of contact with the wallet from inside a
component. It returns a `publicClient` that works with or without a connected
wallet, and a `walletClient` that appears once a wallet connects:

```tsx
import { useEffect, useState } from 'react'
import { useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

function App() {
  const { publicClient, walletClient, address, connected, connect } = useVeilWallet()
  const [balance, setBalance] = useState<bigint>()

  // Reads work immediately, connected or not.
  useEffect(() => {
    if (address) publicClient.getBalance({ address }).then(setBalance)
  }, [address, publicClient])

  // Writes need a connected wallet.
  async function mintCard() {
    if (!walletClient || !address) return
    await walletClient.writeContract({
      program: 'loyalty_token.aleo',
      function: 'mint_card',
      inputs: [address, '0u64', '123field'],
    })
  }

  if (!connected) return <button onClick={() => connect()}>Connect</button>
  return (
    <div>
      <p>Connected: {address}</p>
      <button onClick={mintCard}>Mint card</button>
    </div>
  )
}
```

Any component under `VeilProvider` can call `useVeilWallet` — connection state
is shared across the whole tree, so a wallet button in the header and a
transaction form deeper in the page see the same `address` and `walletClient`.
See [useVeilWallet](/react/use-veil-wallet) for every returned field, the
connect flow, and what each field holds before a wallet connects.

## What the package handles

- Registering the Shield, Leo, Puzzle, and Fox wallet adapters so a dApp does
  not construct or import them individually.
- Wallet discovery — which of those wallets are installed in the browser.
- Selecting and connecting a wallet, and reconnecting automatically to the
  last-used wallet on reload (`autoConnect`).
- Building a `publicClient` that reads chain state without a connection.
- Bridging the connected wallet adapter into a Veil `walletClient` through
  `@provablehq/veil-aleo-wallet-adapter`, so writes go through
  `writeContract`, `requestRecords`, and the rest of the `WalletClient`
  surface rather than a wallet-specific API.
- Forwarding connect-time privacy grants (`programs`, `recordAccess`,
  `readAddress`, `algorithmsAllowed`) to the wallets that support them.
