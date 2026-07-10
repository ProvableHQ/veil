# requestRecords

Fetches the account's records for a program.

Use it to find spendable records — private balances, program-issued assets —
before passing one as a function input, as described in [Working with
records](/guides/working-with-records). Hits the network. Filter with
`statusFilter: 'unspent'` to get only records that can still be spent.

## Usage

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const recordProvider = aleo.createRemoteScanner({
  url: 'https://rss.provable.com',
  consumerId: '<consumer-id>',
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

const records = await client.requestRecords({
  program: 'credits.aleo',
  statusFilter: 'unspent',
})
```

## Account type differences

A wallet-adapter (RPC) account always delegates the scan to the connected
wallet, which may prompt the user. A local SDK account scans through the
client's configured `recordProvider` — typically `aleo.createRemoteScanner()`
— and throws if the client was created without one.

## Returns

`OwnedRecord[] | OwnedRecordEncrypted[]`

The matching records, or an empty array when the account owns none. Each
record carries `programName`, `recordName`, `owner`, `spent`, and the
transaction/transition coordinates that produced it. `includePlaintext: true`
(the default) adds a `recordPlaintext` string to each entry; set it `false`
to get ciphertext-only `OwnedRecordEncrypted` entries instead.

## Parameters

### program

- **Type:** `string`

Program whose records to scan, e.g. `credits.aleo`.

### includePlaintext

- **Type:** `boolean`
- **Default:** `true`

Whether to decrypt and include each record's plaintext.

### statusFilter

- **Type:** `'all' | 'spent' | 'unspent'`
- **Default:** `'all'`

Filters records by spent status.
