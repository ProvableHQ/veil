# requestTransactionHistory

Returns the connected wallet's transaction history for a program.

Only supported for wallet-adapter (RPC) accounts — the adapter keeps
per-program history. There is no local-account equivalent: neither the Aleo
network REST API nor the SDK exposes a transaction-history endpoint, so a
local SDK account throws `TransactionHistoryNotSupportedError`. Read-only;
hits the wallet adapter and never signs.

## Usage

```ts
import { createWalletClient } from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'

const { account, transport } = fromWalletAdapter(connectedAdapter)
const client = createWalletClient({ account, transport })

const { transactions } = await client.requestTransactionHistory({
  program: 'credits.aleo',
})
```

## Returns

`{ transactions: Array<{ transactionId: string; id: string }> }`

The wallet's recorded transactions involving `program`.

## Parameters

### program

- **Type:** `string`

Program whose transactions to list, e.g. `credits.aleo`.
