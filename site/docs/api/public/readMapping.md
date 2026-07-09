# readMapping

Reads a mapping value from a deployed program.

Alias of [readContract](/api/public/readContract) under Aleo-native naming.
Aleo docs call public key/value program state a mapping; viem calls the read
a contract read. The two names call the same function and return the same
raw Aleo literal string. Pick whichever vocabulary fits the surrounding code
— Aleo-native for programs and mappings, viem-shaped for parity with an
existing viem codebase. Hits the network; does not sign or prove.

For a typed read that decodes into a value shaped by the program's ABI, use a
contract instance's `read` methods instead (see
[Contract instances](/guides/contract-instances)).

## Usage

```ts
import { createPublicClient, http, parseValue } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const raw = await client.readMapping({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
// '5000000u64'

const balance = parseValue(raw)
```

## Returns

`string`

The raw Aleo literal stored under the key. Decode it with `parseValue` from
`@provablehq/veil-core` into a structured `ParsedValue`.

## Parameters

### programId

- **Type:** `string`

Program that owns the mapping, such as `"credits.aleo"`.

### mapping

- **Type:** `string`

Mapping name within the program, such as `"account"`.

### key

- **Type:** `string`

Mapping key as an Aleo plaintext literal — an `aleo1…` address, `"1field"`,
and so on.
