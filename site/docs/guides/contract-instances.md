---
sidebar_position: 5
---

# Contract Instances

Contract instances provide typed access to an Aleo program's functions and mappings.

:::caution Work in Progress
The contract abstraction layer is under active development. The API may change.
:::

## Create a Contract Instance

```ts
import { getContract, parseProgram } from '@provablehq/veil-core'

// Fetch and parse the program source
const source = await publicClient.getCode({ program: 'credits.aleo' })
const abi = parseProgram(source)

// Create a typed contract instance
const credits = getContract({
  program: 'credits.aleo',
  abi,
  client: { public: publicClient, wallet: walletClient },
})
```

## Read Mappings

```ts
const balance = await credits.read.account('aleo1...')
```

## Write Functions

```ts
const txId = await credits.write.transfer_public({
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

## ABI from JSON (preferred)

When you have the Leo compiler's ABI output, use `parseAbi` for more accurate types:

```ts
import { parseAbi, getContract } from '@provablehq/veil-core'
import abi from './my_program/build/abi.json'

const program = parseAbi(abi)
const contract = getContract({
  program: program.id,
  abi: program,
  client: publicClient,
})
```
