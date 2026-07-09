---
sidebar_position: 4
---

# Transaction Lifecycle

A transaction submitted through [`writeContract`](/api/wallet/writeContract)
or one of its siblings does not land on chain the instant the call resolves
— the id it returns only means the transaction reached the mempool. Getting
from there to confirmed state on chain takes polling.

## Status values

[`transactionStatus`](/api/wallet/transactionStatus) reports one of four
states:

| Status | Meaning |
| --- | --- |
| `'accepted'` | Confirmed in a block; the transaction succeeded. |
| `'rejected'` | Confirmed in a block, but the transaction failed on-chain (for example, an assertion failed). |
| `'pending'` | In the mempool, not yet confirmed. |
| `'not_found'` | Absent from both pools — never submitted, dropped, or expired. |

Veil does not borrow the EVM term "finalized" for this state. On Aleo,
finalize names something else entirely: the on-chain execution of a
transaction's mapping writes, not confirmation. The four statuses above are
the complete set a caller needs to branch on.

```ts
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['arg1', 'arg2'],
})

const { status } = await walletClient.transactionStatus({ transactionId: txId })
```

A wallet-adapter (RPC) account forwards the status lookup to the connected
wallet's own indexer; a local account, or a client with no account attached,
reads it straight from the network's REST API. Either way the call is
read-only and never signs.

## Polling to acceptance

Poll on an interval until the status leaves `'pending'`:

```ts
async function waitForTransaction(txId: string) {
  while (true) {
    const { status } = await walletClient.transactionStatus({ transactionId: txId })
    if (status === 'accepted' || status === 'rejected') return status
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

const status = await waitForTransaction(txId)
```

`executeContract` folds this wait in for the caller: it polls internally
and only resolves once the transaction reaches `'accepted'` (or throws on
`'rejected'`). `writeContract` plus manual polling suits a caller that wants
to react to `'pending'` in the meantime — a progress indicator, for
instance.

## Reading state after acceptance

`'accepted'` means the transaction is in a block, not that every consequence
of it is immediately visible everywhere. Two effects to account for:

**Mapping writes finalize asynchronously.** A transaction's finalize step —
the mapping updates it causes — can lag a read by a block or so even after
`transactionStatus` reports `'accepted'`. A mapping read expected to reflect
the transaction should be retried, or delayed by a block, rather than trusted
on the first attempt:

```ts
if (status === 'accepted') {
  const newBalance = await publicClient.readMapping({
    programId: 'credits.aleo',
    mapping: 'account',
    key: 'aleo1recipient...',
  })
}
```

**Record outputs take a moment to propagate to a scanner.** If the
transaction produced a new record, [`requestRecords`](/api/wallet/requestRecords)
may not surface it until the scanner has caught up to the block the record
was created in. See [Working with Records](/guides/working-with-records) for
refreshing records safely before spending them.

## The on-chain transaction id

The id `writeContract` returns and the id `transactionStatus` echoes back are
the same `at1...` value — Aleo's on-chain transaction id. Use it directly with
public client lookups once the transaction is accepted:

```ts
const tx = await publicClient.getTransaction({ id: txId })
```
