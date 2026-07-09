---
sidebar_position: 2
---

# Wallet Client

A wallet client signs and submits transactions: calling program functions,
transferring credits, deploying programs, and signing arbitrary messages.
Where a public client only ever reads, a wallet client's methods carry a
side effect — they reach the network and, for anything that touches the
chain, cost a fee.

The client takes one of two account shapes, and the shape it takes decides
who builds and proves the transaction:

- An **RPC account** delegates signing, proving, and record access to a
  connected wallet (Shield, Leo, Puzzle, Fox). The application never sees a
  private key.
- A **local account** holds the private key directly. The caller supplies a
  proving configuration, and Veil builds and proves the transaction
  in-process or through a delegated prover before broadcasting it.

The action surface is identical either way — `writeContract`, `transfer`,
and the rest behave the same from the caller's side. Only the construction
differs, and only internally does the routing change.

## Create a wallet client

### From a wallet adapter (browser)

The wallet adapter path turns any Provable-standard wallet (Shield, Leo,
Puzzle, Fox) into an RPC account and a matching transport. Pair the wallet
transport with an HTTP transport through `fallback` — the wallet transport
handles writes and wallet-specific reads, and the HTTP transport serves
everything else:

```ts
import { createWalletClient, http, fallback } from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'

const { account, transport } = fromWalletAdapter(connectedAdapter)

const client = createWalletClient({
  account,
  transport: fallback([transport, http('https://api.provable.com/v2')]),
})
```

`connectedAdapter` is any adapter that already satisfies
`AleoWalletAdapter` and has completed its own `connect()` call — see
[`@provablehq/veil-aleo-wallet-adapter`](/packages/wallet-adapter).

### From a local private key (Node.js, scripts, bots)

A local account needs its proving configuration built from a network handle.
`loadNetwork` loads the WASM binaries for one network and returns a handle
(`AleoSdk`) whose methods derive accounts, build proving configs, and create
scanners — `privateKeyToAccount` and `createProvingConfig` are methods on
that handle, not top-level exports:

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const recordProvider = aleo.createRemoteScanner({
  url: 'https://api.provable.com/v2',
  consumerId: '<consumer-id>',
  apiKey: '<api-key>',
})
recordProvider.setAccount({ viewKey: account.viewKey })

const client = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl: 'https://api.provable.com/v2',
    proverUrl: 'https://api.provable.com/prove/testnet',
    account,
  }),
  recordProvider,
})
```

`mode: 'delegated'` submits proving to the remote prover service at
`proverUrl`; `mode: 'local'` builds proofs in-process from the handle's WASM
binaries instead, dropping `proverUrl`. See
[`createProvingConfig`](/api/provable-sdk/createProvingConfig) for the full
option set. The scanner's `setAccount` call points record scanning at the
account's view key — without it, `requestRecords` throws.

### From React

A React application does not construct a wallet client directly — the
`useVeilWallet` hook holds the connection and hands back a wallet client once
one is connected:

```tsx
import { useVeilWallet } from '@provablehq/veil-aleo-react-hooks'

const { walletClient } = useVeilWallet()
```

See [`useVeilWallet`](/react/use-veil-wallet).

## Configuration

`createWalletClient` takes one of two shapes, discriminated by the account's
`type`.

**With an RPC account** — the wallet handles proving and records, so no
`proving` or `recordProvider` field applies:

| Field | Type | Description |
| --- | --- | --- |
| `account` | `RpcAccount` | Wallet-delegated signer, typically from `fromWalletAdapter`. |
| `transport` | `Transport` | Carries requests to the network and the wallet. |
| `key` | `string` (optional) | Identifier for the client's type. Defaults to `'wallet'`. |
| `name` | `string` (optional) | Human-readable name. Defaults to `'Wallet Client'`. |

**With a local account** — the caller supplies proving, and optionally a
record provider:

| Field | Type | Description |
| --- | --- | --- |
| `account` | `LocalAccount` | Holds the private key and view key directly. |
| `transport` | `Transport` | Carries requests to the network. |
| `proving` | `ProvingConfig` | Required. Selects where and how transactions are built and proved — see [`createProvingConfig`](/api/provable-sdk/createProvingConfig). |
| `recordProvider` | `RecordProvider` (optional) | Source of unspent records for `requestRecords`. Required to call `requestRecords` with a local account; omitted, the call throws. |
| `key` | `string` (optional) | Identifier for the client's type. Defaults to `'wallet'`. |
| `name` | `string` (optional) | Human-readable name. Defaults to `'Wallet Client'`. |

## Actions

### Writing & deploying

| Action | Description |
| --- | --- |
| [`writeContract`](/api/wallet/writeContract) | Execute a program function and return the transaction id. |
| `executeTransaction` | Alias for `writeContract`, matching Aleo wallet-adapter terminology. |
| [`executeContract`](/api/wallet/executeContract) | Execute a program function and return its per-transition outputs, waiting for confirmation. |
| [`simulateContract`](/api/wallet/simulateContract) | Run a function locally and return its outputs without broadcasting. |
| [`deployContract`](/api/wallet/deployContract) | Deploy a program. |
| [`transfer`](/api/wallet/transfer) | Transfer credits, selecting the transfer function from a visibility mode. |
| [`sendTransaction`](/api/wallet/sendTransaction) | Broadcast an already-built transaction. |

### Signing & records

| Action | Description |
| --- | --- |
| [`signMessage`](/api/wallet/signMessage) | Sign an arbitrary message with the account. |
| [`decrypt`](/api/wallet/decrypt) | Decrypt a record or transition-output ciphertext. |
| [`requestRecords`](/api/wallet/requestRecords) | Fetch the account's records for a program (see [routing](#requestrecords-routing) below). |
| [`requestTransactionHistory`](/api/wallet/requestTransactionHistory) | Get a program's transaction history. RPC accounts only. |

### Status & network

| Action | Description |
| --- | --- |
| [`transactionStatus`](/api/wallet/transactionStatus) | Check a submitted transaction's status. |
| [`switchChain`](/api/wallet/switchChain) | Switch the client's target network. |
| `switchNetwork` | Alias for `switchChain`. |
| [`getChainId`](/api/wallet/getChainId) | Get the current network. |
| `getNetwork` | Alias for `getChainId`. |

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
  amount: 1_000_000n, // 1 credit = 1,000,000 microcredits
})
```

### Fetch and spend a record

```ts
const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
  statusFilter: 'unspent',
})

const card = records.find((r) => r.recordName === 'LoyaltyCard')

const txId = await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'add_points',
  inputs: [card!.recordPlaintext, '100u64'],
})
```

See [Working with Records](/guides/working-with-records) for the full
scanning and spending flow, including the wallet-adapter path where
`inputs` can carry unresolved `InputRequest` objects instead of literals.

### Track transaction status

```ts
const status = await walletClient.transactionStatus({ transactionId: txId })
// { status: 'accepted', transactionId: 'at1...' }
```

Status is one of `accepted`, `rejected`, `pending`, or `not_found` — see
[Transaction status](/api/types#transaction-status).

## `requestRecords` routing

`requestRecords` resolves differently depending on the account backing the
client:

| Account type | Record source | Config required |
| --- | --- | --- |
| RPC (wallet adapter) | The connected wallet's own record scanning | None |
| Local (SDK key) | The client's `recordProvider` | `recordProvider` |

An RPC account routes the call straight to the wallet, which already tracks
its own records. A local account has no wallet to ask, so the wallet client
looks up `recordProvider` — supplied at construction — and throws if none was
given.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

// Remote scanner: registers a view key with the hosted Record Scanning
// Service on the first scan and reuses the registration across calls.
const recordProvider = aleo.createRemoteScanner({
  url: 'https://api.provable.com/v2',
  consumerId: '<consumer-id>',
  apiKey: '<api-key>',
})
recordProvider.setAccount({ viewKey: account.viewKey })

const walletClient = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl: 'https://api.provable.com/v2',
    proverUrl: 'https://api.provable.com/prove/testnet',
    account,
  }),
  recordProvider,
})
```

See [`createRemoteScanner`](/api/provable-sdk/createRemoteScanner) for the
provider's own options, and
[`createStandaloneScanner`](/api/provable-sdk/createStandaloneScanner) for
scanning records outside a wallet client entirely — view-only dashboards or
auditing that need no signer.

## `extend()`

`createWalletClient` builds on the base client and layers `walletActions` on
with `extend`, the same pattern `createPublicClient` and `createTestClient`
use. A wallet client can take further extensions the same way — for example,
composing with [`leoActions`](/api/leo/leoActions) to add a `.leo` property
for building and deploying Leo programs against the same client used to call
them:

```ts
import { leoActions } from '@provablehq/veil-leo'

const client = createWalletClient({ account, transport }).extend(
  leoActions({ cwd: './programs/token' }),
)

await client.leo.build()
```
