---
sidebar_position: 1
---

# Reading Chain State

All reads go through the public client. No wallet connection needed.

## Mappings

Aleo programs store public state in mappings. Read them with `readMapping` (or its alias `readContract`):

```ts
const value = await publicClient.readMapping({
  program: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

The return value includes the Aleo type suffix (e.g. `"1000u64"`). Parse as needed.

## List Available Mappings

```ts
const mappings = await publicClient.getMappingNames({
  program: 'credits.aleo',
})
// ['account', 'bonded', 'unbonding', ...]
```

## Blocks and Transactions

```ts
const height = await publicClient.getBlockNumber()
const block = await publicClient.getBlock({ height: Number(height) })
const tx = await publicClient.getTransaction({ id: 'at1...' })
```

## Programs

```ts
// Fetch program source
const source = await publicClient.getCode({ program: 'credits.aleo' })

// Find the deployment transaction
const deployTxId = await publicClient.getDeploymentTransaction({
  program: 'credits.aleo',
})
```
