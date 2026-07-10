# getMappingKeysValues

Reads every key/value pair in a program mapping from a local devnode.

Applies when a test needs to assert on a program's full public state after a
run — real network REST APIs only serve one mapping value per request, so
enumerating a whole mapping is a devnode-only operation. Read-only; hits the
devnode over the transport.

## Usage

```ts
import { createTestClient, http } from '@provablehq/veil-core'

const client = createTestClient({
  transport: http('http://127.0.0.1:3030', { network: 'testnet' }),
})

const entries = await client.getMappingKeysValues({
  programId: 'credits.aleo',
  mapping: 'account',
})
// [['aleo1q6q...9mxm8', '250000000u64'], ...]
```

## Returns

`[string, string][]`

Every entry in the mapping as `[key, value]` pairs of Aleo plaintext strings.
An empty array when the mapping has none.

## Parameters

### programId

- **Type:** `string`

Program that owns the mapping, for example `credits.aleo`.

### mapping

- **Type:** `string`

Mapping name within that program, for example `account`.
