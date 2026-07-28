# readContract

Reads a public mapping value from a deployed program.

This is the viem-shaped read for Aleo public state: mappings are a program's
on-chain key/value storage, and this fetches the value stored under one key.
The result comes back as the raw Aleo literal string — a number, a boolean, or
a struct literal — decoded with `parseValue` rather than pre-typed. It hits
the network but does not sign or prove.

For a typed read that decodes into a value shaped by the program's ABI, use a
contract instance's `read` methods instead (see
[Contract instances](/guides/contract-instances)). `readContract` stays raw
and untyped for cases without a parsed ABI on hand.

## Usage

```ts
import { createPublicClient, http, parseValue } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const raw = await client.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
// '5000000u64', or null when the account holds no public credits

const balance = raw === null ? 0n : parseValue(raw).value
```

## Returns

`string | null`

The raw Aleo literal stored under the key — for example `"5000000u64"`,
`"true"`, or a struct literal such as `"{owner: aleo1..., amount: 100u64}"`.
Pass it to `parseValue` to decode numbers, booleans, and structs into a
structured `ParsedValue`.

`null` means the node has nothing stored under the key. Absence is a normal
answer for a mapping read, not an error — a `credits.aleo/account` entry does
not exist until the address first holds public credits. The node also answers
`null` for a mapping or program that does not exist, so a typo in `mapping` or
`programId` looks identical to an absent key here; contract instances validate
both names against the ABI before requesting. A malformed key literal is the
one case that throws (`TransportError`, HTTP 404 on the Provable API).

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

## Related

`readMapping` is an alias of this action under Aleo-native naming; the two
behave identically. See [readMapping](/api/public/readMapping).
