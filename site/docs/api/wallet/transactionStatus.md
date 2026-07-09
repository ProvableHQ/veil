# transactionStatus

Returns the status of a submitted transaction.

Read-only; hits the wallet adapter or the network REST API, never signs. A
wallet-adapter (RPC) account forwards the lookup to the connected wallet
(which queries its own indexer); a local account, or a client with no account
attached, derives the status directly from the network's REST API.

Aleo mapping writes finalize asynchronously — a status of `'accepted'` means
the transaction landed in a block, but a subsequent mapping read can still lag
behind it briefly. Poll again, or wait a block, before relying on a mapping
value the transaction was expected to update.

## Usage

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const client = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl: 'https://api.provable.com/v2',
    account,
  }),
})

const { status } = await client.transactionStatus({ transactionId: 'at1...' })
// status: 'accepted' | 'rejected' | 'pending' | 'not_found'
```

## Returns

`{ status: string; transactionId?: string; error?: string }`

`status` is one of:

- `'accepted'` — present in `/transaction/confirmed/{id}` with `status: 'accepted'`.
- `'rejected'` — present in `/transaction/confirmed/{id}` with `status: 'rejected'`.
- `'pending'` — present in `/transaction/unconfirmed/{id}`.
- `'not_found'` — present in neither pool: never submitted, dropped, or expired.

`'not_found'` is returned rather than thrown when the id is unknown.

## Parameters

### transactionId

- **Type:** `string`

On-chain transaction id (`at1...`) to look up.
