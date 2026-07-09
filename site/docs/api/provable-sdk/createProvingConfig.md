---
sidebar_position: 9
---

# createProvingConfig

Creates a `ProvingConfig` for `createWalletClient({ proving })` — the adapter
that lets a wallet client with a local account build, prove, and broadcast
transactions using this handle's network binaries. `'local'` mode builds
proofs in-process from the WASM binaries; `'delegated'` mode submits a
proving request to a remote prover service instead.

## Usage

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const proving = aleo.createProvingConfig({
  mode: 'delegated',
  networkUrl: 'https://api.provable.com/v2',
  proverUrl: 'https://api.provable.com',
  consumerId: '<consumer-id>',
  apiKey: '<api-key>',
  account,
})

const walletClient = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving,
})
```

## Returns

`ProvingConfig`

An object carrying `mode`, `buildTransaction`, `buildDeployment`, `simulate`,
`execute`, `decrypt`, and `switchNetwork` — the hooks
[`createWalletClient`](/clients/wallet-client) uses to build, prove, and
broadcast on behalf of a local account.

## Parameters

### mode

- **Type:** `'delegated' | 'local'`

Where proofs are produced. `'local'` builds proofs in-process using the
handle's WASM binaries; `'delegated'` submits a proving request to the
service at `proverUrl`.

### networkUrl

- **Type:** `string`

Base URL of the Aleo node the built transaction is queried against and, in
local mode, submitted to.

### proverUrl

- **Type:** `string`
- **Optional**

Base URL of the delegated proving service. Required when `mode` is
`'delegated'`; `execute` throws without it.

### apiKey

- **Type:** `string`
- **Optional**

API key for the delegated proving service's JWT issuance.

### consumerId

- **Type:** `string`
- **Optional**

Consumer id used to mint and refresh the JWT for the delegated proving
service.

### account

- **Type:** `LocalAccount<'privateKey'>`
- **Optional**

Account whose private key signs the built transaction and whose view key
decrypts owned record outputs. Required to spend records or decrypt
transaction outputs; omit for account-less reads.

### confirmationTimeout

- **Type:** `number`
- **Optional**
- **Default:** `300_000` (5 minutes)

Milliseconds `execute` waits for the submitted transaction to reach
`accepted` before it throws a timeout error. A `rejected` confirmation
throws immediately, without waiting out the timeout.
