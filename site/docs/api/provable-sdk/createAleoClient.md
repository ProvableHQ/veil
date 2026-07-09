---
sidebar_position: 10
---

# createAleoClient

Creates a fully-wired `publicClient`/`walletClient`/`account` triple from a
private key and network URL in one call — the fastest path to a working
client pair for a script, bot, or server that holds its own key. Derives the
account, builds a shared transport, and wires a
[`createProvingConfig`](./createProvingConfig) for the wallet client
internally.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated',
  proverUrl: 'https://api.provable.com',
  consumerId: '<consumer-id>',
  apiKey: '<api-key>',
  records: aleo.createRemoteScanner({
    url: 'https://api.provable.com/v2',
    consumerId: '<consumer-id>',
  }),
})

const txId = await walletClient.writeContract({
  program: 'credits.aleo',
  function: 'transfer_public',
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

## Returns

`{ publicClient: PublicClient; walletClient: WalletClient; account: LocalAccount<'privateKey'> }`

`publicClient` and `walletClient` share one transport bound to `networkUrl`.
`account` is the `LocalAccount` derived from `privateKey`, wired as the
wallet client's signer.

## Parameters

### privateKey

- **Type:** `string`

Aleo private key (`APrivateKey1...`) the returned account and wallet client
sign with.

### networkUrl

- **Type:** `string`

Base URL of the Aleo node both returned clients read from and broadcast to.

### provingMode

- **Type:** `'delegated' | 'local'`
- **Optional**
- **Default:** `'delegated'`

Where proofs are produced — passed through to `createProvingConfig`.

### proverUrl

- **Type:** `string`
- **Optional**

Base URL of the delegated proving service. Required when `provingMode` is
`'delegated'`.

### apiKey

- **Type:** `string`
- **Optional**

API key for the delegated proving service.

### consumerId

- **Type:** `string`
- **Optional**

Consumer id used to mint and refresh the JWT for the delegated proving
service.

### records

- **Type:** `RecordProvider`
- **Optional**

Record provider wired into the wallet client's `requestRecords`. Not
supplied by default — pass [`createRemoteScanner`](./createRemoteScanner)'s
result or a custom `RecordProvider`. `requestRecords` throws with a setup
hint when none is configured.
