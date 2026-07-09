---
sidebar_position: 3
---

# Working with Records

Records are Aleo's private state, and they are analogous to UTXOs in
Bitcoin. A record is created as the output of a program function; once
another function consumes it as an input, it is spent and can never be used
again. A private balance — a `credits.aleo` holding, a token, a
program-issued asset — is the sum of every unspent record a program has ever
produced for that owner. Finding that balance, or finding a specific record
to spend, means scanning the chain for records the caller owns and checking
which of them are still unspent.

Veil hides that scan behind [`requestRecords`](/api/wallet/requestRecords).
Which mechanism actually performs the scan depends on where the account's
signing key lives.

## Records from a connected wallet

An RPC account — one built with `fromWalletAdapter` or `useVeilWallet` —
delegates the scan to the connected wallet, which maintains its own record
index. No scanner configuration is needed on the client:

```ts
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { createWalletClient } from '@provablehq/veil-core'

const { account, transport } = fromWalletAdapter(connectedAdapter)
const walletClient = createWalletClient({ account, transport })

const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
  statusFilter: 'unspent',
})
```

## Records from a local account

A local account has no wallet to ask, so the wallet client needs its own
`recordProvider`. `loadNetwork`'s handle exposes two scanner factories, both
backed by Provable's Record Scanning Service (RSS):

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const walletClient = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl: 'https://api.provable.com/v2',
    account,
  }),
  recordProvider: aleo.createRemoteScanner({
    url: 'https://api.provable.com/v2',
    consumerId: '<consumer-id>',
  }),
})

const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
  statusFilter: 'unspent',
})
```

`createRemoteScanner`'s first call registers the account's view key with the
service to obtain a scanning session; subsequent calls reuse it. A wallet
client built without a `recordProvider` throws as soon as a local account
calls `requestRecords`.

## Records without a wallet client

A read-only integration — a dashboard, an audit tool — that needs records
but never signs a transaction has no reason to build a wallet client at all.
`createStandaloneScanner` takes an explicit view key and extends a public
client with `withRecords`:

```ts
import { createPublicClient, http, withRecords } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('mainnet')

const scanner = aleo.createStandaloneScanner({
  url: 'https://api.provable.com/v2',
  consumerId: '<consumer-id>',
  viewKey: 'AViewKey1...',
})

const viewClient = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
}).extend(withRecords({ scanner }))

const records = await viewClient.requestRecords({ program: 'loyalty_token.aleo' })
```

This scanner is not pluggable into a wallet client's `recordProvider` — use
`createRemoteScanner` there instead. `createStandaloneScanner` exists
specifically for the no-signer case, and the resulting client can only
scan — it has no `writeContract` to spend what it finds. The rest of this
guide assumes a wallet client from one of the first two paths, since
spending a record requires signing.

## The record shape

Every entry `requestRecords` returns carries `programName`, `recordName`,
`owner`, `spent`, and the transaction and transition coordinates that
produced it. With the default `includePlaintext: true`, each entry also
carries `recordPlaintext` — the decrypted record body:

```
{
  programName: 'loyalty_token.aleo',
  recordName: 'LoyaltyCard',
  spent: false,
  recordPlaintext: '{\n  owner: aleo1....private,\n  card_id: 123field.private,\n  points: 500u64.private,\n  _nonce: ...group.public\n}',
  ...
}
```

Set `includePlaintext: false` to get ciphertext-only entries instead — useful
when the caller only needs to know which records exist, not their contents.
`statusFilter` narrows the scan to `'unspent'`, `'spent'`, or `'all'`
(the default).

## Filtering for spendable records

A record can only be spent once. Filter for `spent: false` before using one
as a function input — passing a spent record fails the transaction:

```ts
const unspentCards = records.filter(
  (r) => r.recordName === 'LoyaltyCard' && !r.spent,
)
```

Pass the `recordPlaintext` string as the input, the same way any other
literal input is passed:

```ts
const card = unspentCards[0]

const txId = await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'add_points',
  inputs: [card.recordPlaintext, '100u64'],
})
```

## Decrypting a record directly

A record ciphertext received outside `requestRecords` — from a program
output, or fetched from a transaction — decrypts with
[`decryptRecord`](/api/provable-sdk/decryptRecord), given the owner's view
key. This is pure and local; no network round trip is made and the view key
never leaves the caller:

```ts
const plaintext = aleo.decryptRecord(account.viewKey, 'record1qyqsq...')
```

## Refreshing before spending

A record fetched some time ago may already be spent by the time it is used
— by a transaction still pending elsewhere, or one that landed since the
last scan. Refresh immediately before spending rather than trusting a
previously fetched list:

```ts
const fresh = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
  statusFilter: 'unspent',
})
const card = fresh.find((r) => r.recordName === 'LoyaltyCard')

if (!card) {
  throw new Error('No unspent card available')
}

await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'add_points',
  inputs: [card.recordPlaintext, '100u64'],
})
```

After a transaction that consumes or creates records is accepted, allow a
moment for the scanner to catch up to that block before expecting
`requestRecords` to reflect the change — see
[Transaction Lifecycle](/guides/transaction-lifecycle) for the acceptance
and propagation timing in full.

## Records as wallet-fulfilled inputs

The examples above pass a record's plaintext directly as a literal input,
which works for both account types. An RPC account has a second option: an
`InputRequest` object that asks the connected wallet to select and supply the
record itself, so the plaintext never has to pass through the caller at all.

```ts
inputs: [
  {
    type: 'record',
    program: 'loyalty_token.aleo',
    recordname: 'LoyaltyCard',
    filters: { points: { gte: '100u64' } },
  },
  '100u64',
]
```

`filters` narrows the wallet's automatic selection by record field; `uid` —
the opaque handle a prior `requestRecords` call attached to a record — pins
the request to that exact record instead. The two are mutually exclusive.
Wallets that predate the privacy feature do not attach a `uid` to their
records, so check for its presence before relying on it.
Local accounts do not support `InputRequest` inputs; `writeContract` and
`executeContract` throw if one is passed on that path, since there is no
wallet to resolve it against.
