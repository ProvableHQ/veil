---
sidebar_position: 9
---

# getPool

Reads a pool's static configuration from the on-chain `pools` mapping.

Returns the token pair, fee tier, enabled flag, and decimal scales — the
values that never change after
[`createPool`](/api/shield-swap/createPool). For live trading state (price,
tick, liquidity) read the `slots` mapping via
[`getSlot`](/api/shield-swap/getSlot) instead. Needs only a transport — no
key, proving, or scanner. Hits the network for one node request via the
client's transport.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
}).extend(shieldSwapActions())

const pool = await client.getPool({ poolKey: '4719…field' })
if (pool) console.log(pool.fee, pool.token0, pool.token1)
// { token0: '1223…field', token1: '4487…field', fee: 3000, enabled: true,
//   scale0: 1000000000000000000n, scale1: 1000000n }
```

## Returns

`Promise<PoolState | null>`

The decoded pool, or `null` when no pool exists under the key.

- **token0** — `string`. Token id (field literal) of the pair's first token.
- **token1** — `string`. Token id (field literal) of the pair's second
  token.
- **fee** — `number`. Fee tier in pips (u16, e.g. `3000` = 0.30%).
- **enabled** — `boolean`. Whether the pool currently accepts swaps and
  liquidity operations.
- **scale0** — `bigint`. Decimal scale for token0 (u128), used to convert
  between raw atomic units and display units.
- **scale1** — `bigint`. Decimal scale for token1 (u128).

## Parameters

### poolKey

- **Type:** `string`

Pool key as an Aleo field literal, including the `field` suffix (e.g.
`'4719…field'`). Obtain keys from the DEX API's `/pools` endpoint or compute
them from a `PoolKey` struct hash.

### program

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

Program to read from. Override to read the same mapping layout from another
shield_swap program.

## Errors

Throws a transport error when the node is unreachable or rejects the
request, and a decode error when the mapping value does not parse as a
`PoolState` — both indicate an environment or deployment problem, not a
missing pool.
