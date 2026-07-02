---
sidebar_position: 3
---

# Working with Records

Records are Aleo's private state. Unlike mappings (public), records are encrypted and owned by a specific address. Many program functions require records as inputs.

## Three Paths to Records

| Path | Scanner | Use case |
|---|---|---|
| **Wallet** | Built into wallet adapter | Browser dApps via `walletClient.requestRecords()` |
| **SDK** | `createLocalScanner` or `createRemoteScanner` | Server-side via `walletClient.requestRecords()` |
| **Standalone** | `createStandaloneScanner` + `withRecords` | View-only / no wallet client needed |

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

Requires a `recordProvider` in the wallet client config. Two scanner factories are available:

### Local scanner

Scans blocks and decrypts records locally. No key material in config — the wallet client derives keys from the account.

```ts
import {
  privateKeyToAccount,
  createProvingConfig,
  createLocalScanner,
} from '@veil/provable-sdk'

const walletClient = createWalletClient({
  account: privateKeyToAccount('APrivateKey1...'),
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: createProvingConfig({ mode: 'delegated' }),
  recordProvider: createLocalScanner({
    url: 'https://api.provable.com/v2',
  }),
})

const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
})
```

### Remote scanner (RSS)

Delegates scanning to a Record Scanning Service. Faster than local scanning for large block ranges.

```ts
import { createRemoteScanner } from '@veil/provable-sdk'

const walletClient = createWalletClient({
  account: privateKeyToAccount('APrivateKey1...'),
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: createProvingConfig({ mode: 'delegated' }),
  recordProvider: createRemoteScanner({
    url: 'https://rss.provable.com',
    consumerId: 'my-app',
  }),
})
```

## Path 3: Standalone (No Wallet Client)

For view-only use cases where you need records but don't need to sign transactions. Uses the `withRecords` extension on a public client.

```ts
import { createPublicClient, http } from '@veil/core'
import { createStandaloneScanner, withRecords } from '@veil/provable-sdk'

const scanner = createStandaloneScanner({
  url: 'https://api.provable.com/v2',
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

The standalone scanner requires an explicit `viewKey` and is **not** pluggable into wallet client config.

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

**Always check `spent: false`** before using a record as input. A spent record will cause the transaction to fail.

```ts
const unspentCards = records.filter(
  r => r.recordName === 'LoyaltyCard' && !r.spent
)
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
