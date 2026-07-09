---
sidebar_position: 3
---

# useVeilWallet

The primary hook for interacting with Aleo from React components. Returns a public client (always available) and a wallet client (after connection).

## Usage

```tsx
import { useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

function App() {
  const { publicClient, walletClient, address, connect, disconnect } = useVeilWallet()
}
```

## Config

Pass an optional config object to override defaults:

```tsx
const { publicClient } = useVeilWallet({
  rpcUrl: 'https://custom-rpc.example.com',
  network: 'testnet',
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `rpcUrl` | `string` | `https://api.provable.com/v2` | RPC endpoint URL |
| `network` | `'mainnet' \| 'testnet'` | From provider | Override the network |

## Return Value

| Property | Type | Description |
|---|---|---|
| `publicClient` | `PublicClient` | Read-only client, always available |
| `walletClient` | `WalletClient \| undefined` | Write client, available after connection |
| `address` | `string \| null` | Connected wallet address |
| `connected` | `boolean` | Whether a wallet is connected |
| `connecting` | `boolean` | Whether a connection is in progress |
| `connect` | `(walletName?: string) => Promise<void>` | Connect a wallet. Pass name to select and connect in one step |
| `disconnect` | `() => Promise<void>` | Disconnect the current wallet |
| `wallets` | `Wallet[]` | Available wallet adapters with install status |
| `selectWallet` | `(name: string) => void` | Select a wallet before connecting |

## Connecting a Wallet

```tsx
// Let user pick from a list
<button onClick={() => connect('Shield Wallet')}>Shield</button>
<button onClick={() => connect('Leo Wallet')}>Leo</button>

// Or select then connect separately
selectWallet('Shield Wallet')
await connect()
```

## Reading and Writing

```tsx
// Reads — always work
const balance = await publicClient.getBalance({ address: 'aleo1...' })

// Writes — require connected wallet
if (walletClient) {
  const txId = await walletClient.writeContract({
    program: 'my_program.aleo',
    function: 'my_function',
    inputs: ['arg1', 'arg2'],
  })
}
```
