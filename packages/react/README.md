# @provablehq/veil-aleo-react-hooks

React bindings for the Veil Aleo SDK.

Provides a `VeilProvider` context provider and a `useVeilWallet` hook that wrap
the Provable/Aleo wallet adapters (Shield, Leo, Puzzle, Fox). Reach for it when
building a React app that connects a wallet and needs viem-shaped clients: the
hook hands back a `publicClient` for chain reads and, once a wallet connects, a
`walletClient` for transactions — no manual adapter bridging. `react` (>=18) is
a peer dependency.

## Installation

```sh
pnpm add @provablehq/veil-aleo-react-hooks @provablehq/veil-core react
```

`react` is a peer dependency — the caller supplies it.

## Usage

Wrap the app in `VeilProvider`, then call `useVeilWallet` in any component below
it. The provider configures all known Aleo wallets; the hook derives its network
from the provider unless the caller overrides it.

```tsx
import { VeilProvider, useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

function Root() {
  return (
    <VeilProvider network="mainnet">
      <Wallet />
    </VeilProvider>
  )
}

function Wallet() {
  const {
    publicClient,   // read-only client, always available
    walletClient,   // write client, defined once connected
    address,        // connected address, or null
    connected,
    connecting,
    connect,        // connect(walletName?) selects + connects in one step
    disconnect,
    wallets,        // available wallets with install status
    selectWallet,   // select a wallet by name before connecting
  } = useVeilWallet()

  if (!connected) {
    return (
      <button disabled={connecting} onClick={() => connect('Shield Wallet')}>
        {connecting ? 'Connecting…' : 'Connect'}
      </button>
    )
  }

  async function send() {
    // walletClient is defined here because `connected` is true.
    const txId = await walletClient!.writeContract({
      program: 'credits.aleo',
      function: 'transfer_public',
      inputs: ['aleo1...', '100u64'],
    })
    console.log(txId)
  }

  return (
    <div>
      <span>{address}</span>
      <button onClick={send}>Send</button>
      <button onClick={disconnect}>Disconnect</button>
    </div>
  )
}
```

Chain reads run without a connected wallet:

```tsx
const { publicClient } = useVeilWallet()
const balance = await publicClient.getBalance({ address: 'aleo1...' })
```

## Configuration

`VeilProvider` (`VeilProviderProps`) accepts:

- `network` — `'mainnet'` or `'testnet'`. Defaults to `'mainnet'`.
- `autoConnect` — reconnect to the previously used wallet. Defaults to `true`.
- `decryptPermission` — decrypt permission level. Defaults to `UponRequest`.
- `programs` — program ids to register with the wallet for decrypt permissions.
- `wallets` — override the default wallet list (Shield, Leo, Puzzle, Fox).
- `recordAccess` — connect-time record/field grant for privacy-preserving wallets.
- `readAddress` — set `false` to transact without the dApp learning the address.
  Defaults to `true`.
- `algorithmsAllowed` — allowlist authorizing `derived` transaction inputs (e.g.
  blinding algorithms).

`useVeilWallet` (`UseVeilWalletConfig`) accepts:

- `rpcUrl` — RPC endpoint. Defaults to the Provable mainnet API.
- `network` — transport network. Defaults to the provider's network.

The hook re-exports `PublicClient`, `WalletClient`, `AleoWalletAdapter`, and
`AnyWalletAdapter` so the caller can type consumers without extra imports.
