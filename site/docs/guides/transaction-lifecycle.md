---
sidebar_position: 4
---

# Transaction Lifecycle

Aleo transactions go through several stages. Veil provides tools to track each one.

## Submit

```ts
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['arg1', 'arg2'],
})
// txId is an internal wallet ID (not yet on-chain)
```

## Poll Status

The wallet tracks the transaction and can report its status:

```ts
const result = await walletClient.transactionStatus({
  transactionId: txId,
})
// { status: 'pending', transactionId: '...' }
// { status: 'Accepted', transactionId: 'at1...' }
```

Status values:
- `"pending"` — submitted, waiting for inclusion
- `"Accepted"` — included in a block
- `"Failed"` / `"Rejected"` — transaction failed

## Refresh State

Once the transaction is accepted, refresh both mappings (public state) and records (private state):

```ts
if (result.status === 'Accepted') {
  // Public state — read mappings
  const newTotal = await publicClient.readMapping({
    program: 'loyalty_token.aleo',
    mapping: 'total_cards',
    key: '0field',
  })

  // Private state — fetch updated records
  // Records may take a few seconds to propagate
  const records = await walletClient.requestRecords({
    program: 'loyalty_token.aleo',
  })
}
```

## On-Chain Transaction ID

The `transactionId` returned by `transactionStatus` after acceptance is the on-chain `at1...` ID. Use this for display and for public client lookups:

```ts
const tx = await publicClient.getTransaction({
  id: result.transactionId, // 'at1...'
})
```

## Full Pattern

```ts
// 1. Submit
const txId = await walletClient.writeContract({ ... })

// 2. Poll until confirmed
const poll = setInterval(async () => {
  const result = await walletClient.transactionStatus({
    transactionId: txId,
  })
  if (result.status === 'Accepted') {
    clearInterval(poll)
    // 3. Refresh state
    await refreshRecords()
    await refreshMappings()
  }
}, 5000)
```
