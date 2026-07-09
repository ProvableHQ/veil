---
sidebar_position: 1
---

# React Integration

`@provablehq/veil-aleo-react-hooks` provides batteries-included React support. All Aleo wallets are auto-configured — no manual adapter setup needed.

## Installation

```bash
npm install @provablehq/veil-core @provablehq/veil-aleo-react-hooks
```

## Setup

Wrap your app with `VeilProvider`:

```tsx
import { VeilProvider } from '@provablehq/veil-aleo-react-hooks'

function Root() {
  return (
    <VeilProvider network="mainnet">
      <App />
    </VeilProvider>
  )
}
```

That's it. Shield, Leo, Puzzle, and Fox wallets are auto-configured.

## Use in Components

```tsx
import { useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

function MyComponent() {
  const {
    publicClient,    // always available
    walletClient,    // available after connect
    address,         // connected address or null
    connected,       // boolean
    connecting,      // boolean
    connect,         // (walletName?: string) => Promise<void>
    disconnect,      // () => Promise<void>
    wallets,         // available wallet adapters
    selectWallet,    // select wallet before connecting
  } = useVeilWallet()

  return (
    <div>
      {connected ? (
        <p>Connected: {address}</p>
      ) : (
        <button onClick={() => connect('Shield Wallet')}>
          Connect Shield
        </button>
      )}
    </div>
  )
}
```

## What's Included

`@provablehq/veil-aleo-react-hooks` handles:
- Wallet discovery (which wallets are installed)
- Wallet selection and connection
- Network configuration
- Program permissions (for wallets like Shield that require them)
- Public client creation (reads work without a wallet)
- Wallet client creation (automatically bridges the connected adapter to veil)
- Auto-reconnect to previously used wallet
