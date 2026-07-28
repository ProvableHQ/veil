---
sidebar_position: 1
---

# Reading Chain State

Aleo programs keep two kinds of state: public mappings, which anyone can
read, and private records, which only their owner can decrypt. This guide
covers the public half. For records, see
[Working with Records](/guides/working-with-records).

Every read in this guide goes through a [public client](/clients/public-client)
— no account, wallet, or private key is involved. A public client wraps a
[transport](/api/transports) pointed at an Aleo node and exposes read-only
actions over it.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const publicClient = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})
```

## Mappings

A mapping is a program's on-chain key-value store, maintained by validators
and updated each block a transaction writes to it. `credits.aleo`'s `account`
mapping, for example, holds every address's public credits balance — reading
it is analogous to reading a contract's storage slot on Ethereum. Fetch a
value with [`readContract`](/api/public/readContract) (or its Aleo-native
alias, [`readMapping`](/api/public/readMapping)):

```ts
import { parseValue } from '@provablehq/veil-core'

const raw = await publicClient.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1q6qstg8q8shwqf5m6q5fcenuwsdqsvp4hhsgfnx5chzjm3secyzqt9mxm8',
})
// '5000000u64', or null when the account holds no public credits

const balance = raw === null ? 0n : parseValue(raw).value
```

The value comes back as the raw Aleo literal the node stores — a number,
boolean, or struct literal with its type suffix still attached (`u64`, in the
example above). `parseValue` decodes suffixed integers of every width
(including `field`, `scalar`, and `group`), booleans, and `aleo1...`
addresses, and throws on anything else — a struct literal needs manual
parsing, or ABI-based decoding through a
[contract instance](/guides/contract-instances). Skip `parseValue` when the
raw string is all that is needed.

A key that has never been written resolves to `null` — a mapping only holds
entries a transaction has actually inserted, and absence is a normal answer,
not an error. Two caveats. First, the node also answers `null` for a mapping
or program name that does not exist, so a typo is indistinguishable from an
absent key on this raw path; a [contract instance](/guides/contract-instances)
validates both names against the ABI before requesting. Second, a malformed
key literal does throw — a `TransportError` (HTTP 404 on the Provable API) —
because the request itself is invalid, not because the key is absent.

For a typed read bound to a program's ABI instead of a raw mapping name and
key, see [Contract instances](/guides/contract-instances).

## Discovering a program's mappings

Before reading a mapping, [`getMappingNames`](/api/public/getMappingNames)
lists what a program exposes:

```ts
const mappings = await publicClient.getMappingNames({ programId: 'credits.aleo' })
// ['account', 'committee', 'bonded', 'unbonding', ...]
```

## Blocks and transactions

[`getBlockNumber`](/api/public/getBlockNumber) returns the current chain
height, widened to `bigint` to match viem's return type even though the
underlying value is a u32 on chain. Convert it with `Number()` before passing
a height into an action such as [`getBlock`](/api/public/getBlock):

```ts
const height = await publicClient.getBlockNumber()
const block = await publicClient.getBlock({ height: Number(height) })
```

`getBlock` returns the full block — header, ratifications, solutions, and
confirmed transactions. Look up a specific transaction by its `at1...` id with
[`getTransaction`](/api/public/getTransaction):

```ts
const tx = await publicClient.getTransaction({ id: 'at1...' })
```

See [Types](/api/types) for the full `Block` and `Transaction` field
reference, and [Transaction Lifecycle](/guides/transaction-lifecycle) for
tracking a transaction from submission through acceptance.

## Programs

[`getCode`](/api/public/getCode) fetches a deployed program's Aleo
instructions source — Veil's analogue of viem's `getCode`, which returns
bytecode. Inspect the source to see a program's functions, mappings, and
record types before calling it:

```ts
const source = await publicClient.getCode({ programId: 'credits.aleo' })
```

[`getDeploymentTransaction`](/api/public/getDeploymentTransaction) finds the
transaction that deployed a program, including the deployer's address and
signature:

```ts
const deployTx = await publicClient.getDeploymentTransaction({
  programId: 'credits.aleo',
})
```
