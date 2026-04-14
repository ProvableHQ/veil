---
sidebar_position: 2
---

# Wallet Client

The wallet client provides write access to the Aleo network through a connected wallet or local account.

## Create a Wallet Client

### From a wallet adapter (browser)

```ts
import { createWalletClient, http, fallback } from '@veil/core'
import { fromWalletAdapter } from '@veil/wallet-adapter'

const { account, transport } = fromWalletAdapter(connectedAdapter)

const client = createWalletClient({
  account,
  transport: fallback([transport, http('https://api.provable.com/v2')]),
})
```

### From a private key (Node.js)

```ts
import { createWalletClient, http } from '@veil/core'
import { privateKeyToAccount, createProvingConfig } from '@veil/provable'

const client = createWalletClient({
  account: privateKeyToAccount('APrivateKey1...'),
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: createProvingConfig({ mode: 'delegated' }),
})
```

### From React (recommended)

```tsx
import { useVeilWallet } from '@veil/react'

const { walletClient } = useVeilWallet()
```

## Actions

| Action | Description |
|---|---|
| `writeContract({ program, function, inputs, fee? })` | Execute a program function |
| `executeTransaction(...)` | Alias for `writeContract` |
| `deployContract({ program, fee? })` | Deploy a program |
| `transfer({ to, amount, visibility? })` | Transfer credits |
| `signMessage({ message })` | Sign an arbitrary message |
| `sendTransaction({ transaction })` | Broadcast a raw transaction |
| `decrypt({ ciphertext })` | Decrypt a record ciphertext |
| `requestRecords({ program })` | Fetch records owned by the connected account |
| `requestTransactionHistory({ program })` | Get transaction history for a program |
| `transactionStatus({ transactionId })` | Check transaction status |
| `switchChain({ network })` | Switch the wallet's connected network |
| `switchNetwork({ network })` | Alias for `switchChain` |
| `getChainId()` | Get the current network from the connected wallet |

## Account Types

The wallet client supports two account types:

### RPC Account (`type: 'rpc'`)

The wallet handles proving, signing, and broadcasting. This is what you get from `fromWalletAdapter()` or `useVeilWallet()`.

```ts
// writeContract routes to: adapter.executeTransaction()
const txId = await walletClient.writeContract({ ... })
```

### Local Account (`type: 'local'`)

You provide the private key and proving config. Veil builds the transaction locally and broadcasts it.

```ts
// writeContract routes to: proving.buildTransaction() → sendTransaction()
const txId = await walletClient.writeContract({ ... })
```

The calling code is identical. The routing happens internally based on account type.

## Examples

### Execute a program function

```ts
const txId = await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'mint_card',
  inputs: ['aleo1...', '0u64', '12345field'],
})
```

### Transfer credits

```ts
const txId = await walletClient.transfer({
  to: 'aleo1recipient...',
  amount: 1000000n, // 1 credit = 1,000,000 microcredits
})
```

### Fetch and use records

```ts
const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
})

// Filter for unspent records
const card = records.find(r => !r.spent && r.recordName === 'LoyaltyCard')

// Use as input to a function
const txId = await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'add_points',
  inputs: [card.recordPlaintext, '100u64'],
})
```

### Get transaction history

```ts
const history = await walletClient.requestTransactionHistory({
  program: 'loyalty_token.aleo',
})
```

### Track transaction status

```ts
const status = await walletClient.transactionStatus({
  transactionId: txId,
})
// { status: 'Accepted', transactionId: 'at1...' }
```

### Switch network

```ts
await walletClient.switchChain({ network: 'testnet' })

// or use the alias
await walletClient.switchNetwork({ network: 'mainnet' })
```

### Get current network

```ts
const network = await walletClient.getChainId()
// 'mainnet'
```
