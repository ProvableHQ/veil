---
sidebar_position: 10
---

# createAleoClient

Creates a fully-wired `publicClient`/`walletClient`/`account` triple from a
private key in one call — the fastest path to a working client pair for a
script, bot, or server that holds its own key. Derives the account, builds a
shared transport, wires a [`createProvingConfig`](./createProvingConfig) for
the wallet client, and attaches a [`createRemoteScanner`](./createRemoteScanner)
for record reads.

Every hosted service defaults to the Provable gateway at
`https://edge.provable.com/api`, which needs no credentials: the node API for
reads and broadcasts, the delegated prover with its FeeMaster paying fees, and
the record scanner. A private key alone is a working client; each service is
an option for a self-hosted or legacy deployment.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const { publicClient, walletClient, account } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
})

const txId = await walletClient.writeContract({
  program: 'credits.aleo',
  function: 'transfer_public',
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

The same client, with every default written out:

```ts
const { walletClient } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://edge.provable.com/api/v2',
  provingMode: 'delegated',
  proverUrl: 'https://edge.provable.com/api/prove',
  useFeeMaster: true,
  records: aleo.createRemoteScanner({
    url: 'https://edge.provable.com/api/scanner',
  }),
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
- **Optional**
- **Default:** `'https://edge.provable.com/api/v2'` (`DEFAULT_NETWORK_URL`)

Base URL of the Aleo node both returned clients read from and broadcast to,
without the network segment — the transport appends it, which is what lets
`switchChain` re-target reads. Pass an override for a self-hosted node or a
devnode.

### provingMode

- **Type:** `'delegated' | 'local'`
- **Optional**
- **Default:** `'delegated'`

Where proofs are produced — passed through to `createProvingConfig`. `'local'`
proves in-process and reaches no prover.

### proverUrl

- **Type:** `string`
- **Optional**
- **Default:** `'https://edge.provable.com/api/prove'` (`DEFAULT_PROVER_URL`)

Base URL of the delegated proving service, without the network segment. Only
read under `provingMode: 'delegated'`; pass an override for a self-hosted
prover.

### useFeeMaster

- **Type:** `boolean`
- **Optional**
- **Default:** `true`

Whether the delegated prover pays the transaction fee from its FeeMaster
account instead of the caller's public credits. The default lets a
faucet-funded account with no public credits write. Pass `false` when the
account funds its own fees. Only meaningful under delegated proving.

### apiKey

- **Type:** `string`
- **Optional**

API key for the legacy JWT model. With `consumerId` it forms the pair a session
mints JWTs from when `proverUrl` names a legacy gateway such as
`https://api.provable.com/prove`. On the default gateway the pair is carried and
nothing mints. For a provisioned gateway key use `auth`.

### consumerId

- **Type:** `string`
- **Optional**

Consumer id for the legacy JWT model, paired with `apiKey`. Omit both for the
default gateway, which needs no consumer.

### records

- **Type:** `RecordProvider`
- **Optional**
- **Default:** `aleo.createRemoteScanner()`

Record provider wired into the wallet client's `requestRecords`. Defaults to
a [`createRemoteScanner`](./createRemoteScanner) against the hosted scanner;
pass a scanner built with a custom `url` or any custom `RecordProvider` to
override.
