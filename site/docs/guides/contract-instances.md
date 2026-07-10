---
sidebar_position: 5
---

# Contract Instances

Calling [`readContract`](/api/public/readContract) or
[`writeContract`](/api/wallet/writeContract) directly means naming the
program, mapping, and function by hand on every call. A contract instance
binds one program to a client once and exposes its mappings and functions as
callable methods instead — the same shape viem's `getContract` gives an
Ethereum contract.

## Creating an instance

`getContract` takes a program id, a client, and an optional ABI. Construction
is pure and local; the network is only touched when a method on the instance
is called. The examples below assume a `publicClient` and `walletClient`
already in hand — see [Reading Chain State](/guides/reading-chain-state) and
[Executing Transactions](/guides/executing-transactions) for building each.

```ts
import { parseProgram, getContract } from '@provablehq/veil-core'

const source = await publicClient.getCode({ programId: 'credits.aleo' })
const abi = parseProgram(source)

const credits = getContract({
  program: 'credits.aleo',
  abi,
  client: { public: publicClient, wallet: walletClient },
})
```

`client` also accepts a bare `PublicClient` or `WalletClient` for an instance
that only needs to do one of the two. A public-client-only instance can read
but throws if a write, simulate, or execute method is called; a
wallet-client-only instance can write but throws on reads.

## Reading mappings

Each mapping the ABI declares becomes a method on `read`, keyed by mapping
name:

```ts
const balance = await credits.read.account({ key: 'aleo1...' })
```

This is equivalent to calling `publicClient.readContract({ programId: 'credits.aleo', mapping: 'account', key })`
directly, but the program id and mapping name no longer need repeating at
every call site, and a typo in the mapping name throws immediately rather
than reaching the network.

## Writing functions

Each function the ABI declares becomes a method on `write`, keyed by
function name, broadcasting a transaction and returning its transaction id:

```ts
const txId = await credits.write.transfer_public({
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

Native JavaScript values passed in `inputs` are encoded to Aleo strings
automatically against the ABI's declared types; Aleo-encoded strings pass
through unchanged.

## Simulating and executing

`simulate` runs a function locally through the wallet client's proving
config and returns its parsed outputs without broadcasting — no fee, no
on-chain trace:

```ts
const { outputs } = await credits.simulate.transfer_public({
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

`execute` broadcasts, waits for confirmation, and returns the same parsed
shape as `simulate` plus the transaction id:

```ts
const { transactionId, outputs } = await credits.execute.transfer_public({
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

Both walk every transition the call produced, including transitions the call
triggered in other programs, and parse any output that looks like a record
into its structured fields rather than leaving it as a plaintext string.

## ABI sources

`parseProgram` above extracts function signatures, mapping types, and
closures from a program's Aleo source with a lightweight parser — enough to
validate method names and encode literal inputs. When the Leo compiler's ABI
JSON is available, `parseAbi` produces a richer, more precise ABI from it:

```ts
import { parseAbi, getContract } from '@provablehq/veil-core'
import abi from './my_program/build/abi.json'

const program = parseAbi(abi)
const contract = getContract({
  program: program.id,
  abi: program,
  client: { public: publicClient, wallet: walletClient },
})
```

Passing the ABI as a `const` value gives the returned instance static
TypeScript types for its mappings and functions, so `credits.read.account`
and `credits.write.transfer_public` are typed rather than dynamic proxies.
For a deployed program known ahead of time, `@provablehq/veil-codegen`
generates this typed binding as a build step instead of parsing the ABI at
runtime — see its [package page](/packages/codegen).

## Fetching the ABI on demand

An instance created without an ABI validates nothing and encodes nothing —
methods still work as dynamic proxies, but a typo in a name is not caught
until the call reaches the network. `fetchAbi` fetches the program's current
source, parses it, and caches the result as the instance's `abi`:

```ts
const contract = getContract({ program: 'credits.aleo', client: publicClient })
const abi = await contract.fetchAbi()
```
