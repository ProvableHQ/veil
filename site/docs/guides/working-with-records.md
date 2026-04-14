---
sidebar_position: 3
---

# Working with Records

Records are Aleo's private state. Unlike mappings (public), records are encrypted and owned by a specific address. Many program functions require records as inputs.

## Fetching Records

```ts
const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
})
```

The wallet returns all records it knows about for that program, including spent ones.

## Record Shape

Each record returned by the wallet looks like:

```ts
{
  recordName: 'LoyaltyCard',
  spent: false,
  programName: 'loyalty_token.aleo',
  recordPlaintext: '{\n  owner: aleo1....private,\n  card_id: 123field.private,\n  points: 500u64.private,\n  tier: 1u8.private,\n  _nonce: ...group.public\n}',
  // ... additional metadata
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
