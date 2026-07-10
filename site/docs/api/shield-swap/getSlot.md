---
sidebar_position: 10
---

# getSlot

Reads a pool's live trading state from the on-chain `slots` mapping.

The slot carries everything that moves as the pool trades: the current
`sqrt_price` (Q64 fixed-point, `bigint`), the active `tick`, in-range
`liquidity`, fee-growth accumulators, and the `next_init_below`/
`next_init_above` tick neighbors used for insert hints. This — not the
static [`getPool`](/api/shield-swap/getPool) entry — is the source for
building swap parameters and slippage limits. Needs only a transport — no
key, proving, or scanner. Hits the network for one node request via the
client's transport.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
}).extend(shieldSwapActions())

const slot = await client.getSlot({ poolKey })
if (slot) console.log(slot.sqrt_price, slot.tick, slot.liquidity)
// { tick: -60420, tick_spacing: 60, sqrt_price: 79228162514264337593543950336n,
//   fee_protocol: 0, liquidity: 500000000000n,
//   fee_growth_global0_x_64: 0n, fee_growth_global1_x_64: 0n,
//   fee_residual0_x_64: 0n, fee_residual1_x_64: 0n,
//   max_liquidity_per_tick: 11505743598341114571880798222544994n,
//   protocol_fees0: 0n, protocol_fees1: 0n,
//   next_init_below: -62400, next_init_above: -60000 }
```

## Returns

`Promise<Slot | null>`

The decoded live slot, or `null` when no pool exists under the key.

- **tick** — `number`. The pool's active tick (i32).
- **tick_spacing** — `number`. The pool's tick spacing (u32), fixed at
  creation.
- **sqrt_price** — `bigint`. Current price as a Q64 fixed-point sqrt price
  (u128).
- **fee_protocol** — `number`. Protocol fee share as a fraction of 16 (u8):
  `0` (disabled) or `4`–`10`, i.e. 4/16 to 10/16 of the swap fee routed to
  the protocol.
- **liquidity** — `bigint`. In-range liquidity currently active (u128).
- **fee_growth_global0_x_64** — `bigint`. Cumulative token0 fee growth (Q64,
  u128).
- **fee_growth_global1_x_64** — `bigint`. Cumulative token1 fee growth (Q64,
  u128).
- **fee_residual0_x_64** — `bigint`. Undistributed token0 fee remainder
  (Q64, u128).
- **fee_residual1_x_64** — `bigint`. Undistributed token1 fee remainder
  (Q64, u128).
- **max_liquidity_per_tick** — `bigint`. Per-tick liquidity cap (u128), bound
  to `tick_spacing`.
- **protocol_fees0** — `bigint`. Accrued protocol fees in token0 (u128).
- **protocol_fees1** — `bigint`. Accrued protocol fees in token1 (u128).
- **next_init_below** — `number`. Nearest initialized tick at or below the
  active tick, used as an insert hint.
- **next_init_above** — `number`. Nearest initialized tick above the active
  tick, used as an insert hint.

## Parameters

### poolKey

- **Type:** `string`

Pool key as an Aleo field literal, including the `field` suffix. Same key
space as [`getPool`](/api/shield-swap/getPool).

### program

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

Program to read from.

## Errors

Throws a transport error when the node is unreachable or rejects the
request, and a decode error when the value does not parse as a `Slot` —
both indicate an environment or deployment problem, not a missing pool.
