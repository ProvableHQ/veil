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
import { loadNetwork } from '@veil/provable'

const aleo = await loadNetwork('testnet')
const networkUrl = 'https://api.provable.com/v2'

const client = createWalletClient({
  account: aleo.privateKeyToAccount('APrivateKey1...'),
  transport: http(networkUrl, { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl,
    proverUrl: 'https://prover.provable.com',
  }),
  recordProvider: aleo.createRemoteScanner({
    url: 'https://rss.provable.com',
    consumerId: 'my-app',
  }),
})
```

For the common case, `aleo.createAleoClient({ privateKey, networkUrl })` returns the public client, wallet client, and account in one call.

### From React (recommended)

```tsx
import { useVeilWallet } from '@veil/react'

const { walletClient } = useVeilWallet()
```

## Actions

| Action | Description |
|---|---|
| `writeContract({ program, function, inputs, privateFee?, imports? })` | Submit a program execution. Returns the transaction id only. |
| `executeTransaction(...)` | Alias for `writeContract` — matches the Aleo wallet adapter spec. |
| `simulateContract({ program, function, inputs, ... })` | Dry-run a program function locally (local accounts only). Returns parsed outputs without broadcasting. |
| `executeContract({ program, function, inputs, fee?, ... })` | Build, broadcast, wait for confirmation, and return per-transition outputs. |
| `deployContract({ program, privateFee? })` | Deploy a program |
| `transfer({ to, amount, visibility?, asset? })` | Transfer credits (or any token program following the same naming convention) |
| `signMessage({ message })` | Sign an arbitrary message |
| `sendTransaction({ transaction })` | Broadcast a raw transaction |
| `decrypt({ ciphertext })` | Decrypt a record ciphertext |
| `requestRecords({ program, statusFilter?, includePlaintext? })` | Fetch records owned by the connected account ([routing details](#requestrecords-routing)) |
| `requestTransactionHistory({ program })` | Get transaction history for a program |
| `transactionStatus({ transactionId })` | Check transaction status (`accepted` / `rejected` / `pending` / `not_found`) |
| `switchChain({ network })` | Switch the wallet's connected network |
| `switchNetwork({ network })` | Alias for `switchChain` |
| `getChainId()` | Get the current network from the connected wallet |
| `getNetwork()` | Alias for `getChainId` |

## Account Types

The wallet client supports two account types:

### RPC Account (`type: 'rpc'`)

The wallet handles proving, signing, and broadcasting. This is what you get from `fromWalletAdapter()` or `useVeilWallet()`.

```ts
// writeContract routes to: adapter.executeTransaction()
const txId = await walletClient.writeContract({ ... })
```

### Local Account (`type: 'local'`)

You provide the private key and proving config. Veil builds the transaction locally and broadcasts it. Created by `aleo.privateKeyToAccount(...)` or `aleo.mnemonicToAccount(...)` from `@veil/provable`. The `source` field tags how the account was derived (`'privateKey'` or `'mnemonic'`).

```ts
// writeContract routes to: proving.buildTransaction() → sendTransaction()
const txId = await walletClient.writeContract({ ... })
```

The calling code is identical. The routing happens internally based on account type.

## Client Config Variants

`WalletClientConfig` is a discriminated union:

```ts
// RPC: wallet handles records — no recordProvider here
type RpcWalletClientConfig = {
  account: RpcAccount
  transport: Transport
}

// Local: must supply a proving config; recordProvider optional
type LocalWalletClientConfig = {
  account: LocalAccount
  transport: Transport
  proving: ProvingConfig          // required
  recordProvider?: RecordProvider // required only if you call requestRecords
}
```

The proving config's `mode` is one of `'delegated'` (DPS), `'local'` (in-process WASM), or `'devnode'` (for the `createDevnodeClient()` shortcut).

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

## `requestRecords` Routing

How `requestRecords` resolves depends on account type:

| Account type | Source | Config required |
|---|---|---|
| RPC (wallet) | Wallet adapter transport | None |
| Local (SDK) | `recordProvider` in wallet client config | `recordProvider` |

**RPC account** — The wallet handles record scanning internally. No extra config.

**Local account** — You must supply a `recordProvider`. Without one, `requestRecords` throws.

```ts
import { loadNetwork } from '@veil/provable'

const aleo = await loadNetwork('testnet')
const networkUrl = 'https://api.provable.com/v2'

// Remote scanner — uses Provable's Record Scanning Service (RSS).
// This is the supported scanner for wallet-client record providers.
const walletClient = createWalletClient({
  account: aleo.privateKeyToAccount('APrivateKey1...'),
  transport: http(networkUrl, { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl,
    proverUrl: 'https://prover.provable.com',
  }),
  recordProvider: aleo.createRemoteScanner({
    url: 'https://rss.provable.com',
    consumerId: 'my-app',
  }),
})
```

> For view-only / no-wallet-client use cases, use `aleo.createStandaloneScanner({ url, consumerId, viewKey })` together with the `withRecords` extension on a public client. See [Working with Records](/guides/working-with-records).

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
// { status: 'accepted', transactionId: 'at1...' }
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
