---
sidebar_position: 3
---

# Working with Records

Records are Aleo's private state. Unlike mappings (public), records are encrypted and owned by a specific address. Many program functions require records as inputs.

## Three Paths to Records

| Path | Scanner | Use case |
|---|---|---|
| **Wallet** | Built into wallet adapter | Browser dApps via `walletClient.requestRecords()` |
| **SDK** | `aleo.createRemoteScanner` | Server-side via `walletClient.requestRecords()` (RSS-backed) |
| **Standalone** | `aleo.createStandaloneScanner` + `withRecords` extension on `@veil/core` | View-only / no wallet client needed |

> `aleo` here is the handle returned by `await loadNetwork('mainnet' | 'testnet')` from `@veil/provable`. The standalone scanner extension (`withRecords`) is exported from `@veil/core`.

## Path 1: Wallet (RPC Account)

No config needed. The wallet handles scanning internally.

```ts
const { account, transport } = fromWalletAdapter(connectedAdapter)
const walletClient = createWalletClient({ account, transport })

const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
})
```

## Path 2: SDK (Local Account)

Requires a `recordProvider` in the wallet client config. The supported provider is `createRemoteScanner` (RSS-backed); the active account's view key is wired automatically by the wallet client.

```ts
import { createWalletClient, http } from '@veil/core'
import { loadNetwork } from '@veil/provable'

const aleo = await loadNetwork('testnet')
const networkUrl = 'https://api.provable.com/v2'

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

const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
})
```

Without a `recordProvider`, `walletClient.requestRecords` throws with a setup hint.

## Path 3: Standalone (No Wallet Client)

For view-only use cases where you need records but don't need to sign transactions. Uses the `withRecords` extension (from `@veil/core`) on a public client.

```ts
import { createPublicClient, http, withRecords } from '@veil/core'
import { loadNetwork } from '@veil/provable'

const aleo = await loadNetwork('mainnet')

const scanner = aleo.createStandaloneScanner({
  url: 'https://rss.provable.com',
  consumerId: 'my-app',
  viewKey: 'AViewKey1...',
})

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
}).extend(withRecords({ scanner }))

const records = await client.requestRecords({
  program: 'loyalty_token.aleo',
})
```

The standalone scanner requires an explicit `viewKey` and is **not** pluggable into wallet client config — use `createRemoteScanner` for that.

## Record Shape

Each record returned looks like:

```ts
{
  recordName: 'LoyaltyCard',
  spent: false,
  programName: 'loyalty_token.aleo',
  recordPlaintext: '{\n  owner: aleo1....private,\n  card_id: 123field.private,\n  points: 500u64.private,\n  tier: 1u8.private,\n  _nonce: ...group.public\n}',
}
```

## Filtering for Usable Records

**Always check `spent: false`** before using a record as input. A spent record will cause the transaction to fail. You can also push spent filtering into the request — `statusFilter: 'unspent'` (the default in most flows) hides spent records server-side:

```ts
const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
  statusFilter: 'unspent', // 'all' | 'spent' | 'unspent'
})

const unspentCards = records.filter(r => r.recordName === 'LoyaltyCard' && !r.spent)
```

## Using Records as Inputs

Pass the `recordPlaintext` string as the input:

```ts
const card = unspentCards[0]

const txId = await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'add_points',
  inputs: [card.recordPlaintext, '100u64'],
})
```

## Record Lifecycle

When a transaction consumes a record, that record becomes **spent** and a new record is created with the updated state. After a transaction confirms:

1. The input record is now spent (`spent: true`)
2. A new record exists with the updated values
3. Call `requestRecords` again to get the fresh record

**Important:** Always refresh records before using them. If a previous transaction is still pending, the record may already be spent but your local state doesn't know yet.

```ts
// Refresh before each transaction
const freshRecords = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
})
const card = freshRecords.find(r => r.recordName === 'LoyaltyCard' && !r.spent)

if (!card) {
  throw new Error('No unspent card available')
}

await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'add_points',
  inputs: [card.recordPlaintext, '100u64'],
})
```

## Detecting New Records

Records are identified by their nonce. After a transaction confirms, poll `requestRecords` until you see a record with a new nonce — that's your updated state.

```ts
const nonce = plaintext.match(/_nonce:\s*(\d+)group/)?.[1]
```
