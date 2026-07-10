# getProgramCallsPaginated

Fetches one page of a program's call history with cursor pagination.

Use this over [`getProgramCalls`](/api/public/getProgramCalls) for typed
results or more than the latest feed. To fetch the following page, pass the
returned `next_cursor` fields back as `cursorBlockNumber` and
`cursorTransitionId`. Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const page = await client.getProgramCallsPaginated({ programId: 'credits.aleo', limit: 20 })
// { calls: [{ transaction_id: 'at1...', function_id: 'transfer_public', block_number: 100, block_timestamp: '1700000000', status: 'accepted' }, ...], prev_cursor: null, next_cursor: { block_number: 80, transition_id: 'au1...' } }

if (page.next_cursor) {
  const next = await client.getProgramCallsPaginated({
    programId: 'credits.aleo',
    cursorBlockNumber: page.next_cursor.block_number,
    cursorTransitionId: page.next_cursor.transition_id,
  })
}
```

## Returns

`{ prev_cursor: ProgramCallsCursor | null; next_cursor: ProgramCallsCursor | null; calls: ProgramCall[] }`

One page of the program's call history. `prev_cursor` is `null` at the start
of the history and `next_cursor` is `null` at the end; each cursor carries
`block_number` and `transition_id` for the neighboring page. Each entry in
`calls` carries the `transaction_id` (`at1…`) that carried the call, the
`function_id` called, the `block_number` and `block_timestamp` (unix seconds,
as a string) it landed in, and its `status` (`accepted` or `rejected`).

## Parameters

### programId

- **Type:** `string`

Program whose call history to page through.

### limit

- **Type:** `number`
- **Optional**
- **Default:** 20 (server-side)

Page size, 1–50.

### cursorBlockNumber

- **Type:** `number`
- **Optional**

Block height of the cursor to page from, taken from a previous page's
`next_cursor` or `prev_cursor`. Omit both cursor fields to start from the
newest calls.

### cursorTransitionId

- **Type:** `string`
- **Optional**

Transition ID of the cursor to page from, paired with `cursorBlockNumber`.

### direction

- **Type:** `'next' | 'prev'`
- **Optional**

Page forward (`'next'`) or backward (`'prev'`) from the cursor.

### sort

- **Type:** `'asc' | 'desc'`
- **Optional**

Block-height order of results within a page.
