# sendTransaction

Broadcasts an already-built transaction to the network.

Applies when a transaction was proved elsewhere — a delegated prover, an
offline build — and only needs submitting. Does not sign or prove; the
higher-level write actions ([`writeContract`](/api/wallet/writeContract),
[`deployContract`](/api/wallet/deployContract)) build the transaction and call
this internally. Hits the network and returns as soon as the node accepts the
broadcast — it does not wait for the transaction to be accepted into a block.
Poll [`transactionStatus`](/api/wallet/transactionStatus) for that.

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

const txId = await client.sendTransaction({
  transaction: JSON.stringify(builtTransaction),
})
// 'at1...'
```

## Returns

`string`

The transaction id (`at1...`) assigned by the network on broadcast.

## Parameters

### transaction

- **Type:** `string`

Fully built transaction as a JSON string — already proved and fee-paid, ready
for the network verbatim.
