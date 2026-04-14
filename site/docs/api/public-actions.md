---
sidebar_position: 1
---

# Public Actions

Actions available on the public client. All are read-only and require no wallet connection.

## getBalance

Returns the credits balance for an address in microcredits.

```ts
const balance = await publicClient.getBalance({ address: 'aleo1...' })
// bigint
```

**Parameters:** `{ address: string }`
**Returns:** `bigint`

## getBlockNumber

Returns the latest block height.

```ts
const height = await publicClient.getBlockNumber()
```

**Returns:** `bigint`

## getBlock

Returns a block by height or hash.

```ts
const block = await publicClient.getBlock({ height: 1000 })
const block = await publicClient.getBlock({ hash: '...' })
```

**Parameters:** `{ height?: number; hash?: string }`

## readContract / readMapping

Reads a single mapping value from a program.

```ts
const value = await publicClient.readMapping({
  program: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

**Parameters:** `{ program: string; mapping: string; key: string }`
**Returns:** `unknown`

## getCode

Returns the source code of a deployed program.

```ts
const source = await publicClient.getCode({ program: 'credits.aleo' })
```

**Parameters:** `{ program: string }`
**Returns:** `string`

## getTransaction

Returns transaction details by ID.

```ts
const tx = await publicClient.getTransaction({ id: 'at1...' })
```

**Parameters:** `{ id: string }`

## getMappingNames

Returns all mapping names for a program.

```ts
const names = await publicClient.getMappingNames({ program: 'credits.aleo' })
// ['account', 'bonded', 'unbonding', ...]
```

**Parameters:** `{ program: string }`
**Returns:** `string[]`

---

See [Public Client](/clients/public-client) for the complete list of all actions.
