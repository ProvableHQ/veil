---
sidebar_position: 4
---

# Transaction Lifecycle

Aleo transactions go through several stages. Veil provides tools to track each one.

## Two Paths

- **Manual** — `writeContract` returns the transaction id, then you poll `transactionStatus` and decide what to refresh.
- **One-shot** — `executeContract` builds, broadcasts, waits for confirmation, parses per-transition outputs, and returns them. No polling required.

## Submit

```ts
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['arg1', 'arg2'],
})
// For RPC accounts, txId starts as an internal wallet id; after acceptance it resolves to an at1... id.
// For local accounts, txId is the on-chain at1... id.
```

## Poll Status

```ts
const result = await walletClient.transactionStatus({
  transactionId: txId,
})
// { status: 'pending',   transactionId: '...' }
// { status: 'accepted',  transactionId: 'at1...' }
// { status: 'rejected',  transactionId: 'at1...', error?: '...' }
// { status: 'not_found' }
```

Status values:
- `"pending"` — present in the unconfirmed pool
- `"accepted"` — present in `/transaction/confirmed/{id}` with `status: 'accepted'`
- `"rejected"` — present in `/transaction/confirmed/{id}` with `status: 'rejected'`
- `"not_found"` — present in neither pool (never submitted, dropped, or expired)

> `"finalized"` is **not** an Aleo status — that's an EVM term. Use `"accepted"`.

## Refresh State

Once the transaction is accepted, refresh both mappings (public state) and records (private state):

```ts
if (result.status === 'accepted') {
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

## Full Pattern — manual

```ts
// 1. Submit
const txId = await walletClient.writeContract({ ... })

// 2. Poll until confirmed
const poll = setInterval(async () => {
  const result = await walletClient.transactionStatus({
    transactionId: txId,
  })
  if (result.status === 'accepted') {
    clearInterval(poll)
    // 3. Refresh state
    await refreshRecords()
    await refreshMappings()
  } else if (result.status === 'rejected') {
    clearInterval(poll)
    handleRejection(result.error)
  }
}, 5000)
```

## Full Pattern — one-shot

```ts
const { transactionId, transitions, outputs } = await walletClient.executeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['arg1', 'arg2'],
})

// At this point the tx is confirmed and outputs are parsed.
await refreshRecords()
await refreshMappings()
```

`executeContract` requires a transport that can reach the chain (an HTTP transport, or a `fallback` that includes one) so the confirmation poll has a route. A wallet-only transport will time out.
