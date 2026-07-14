---
sidebar_position: 13
---

# getTick

Reads an initialized tick from the on-chain `ticks` mapping.

Returns the tick's net/gross liquidity, fee-growth-outside snapshots, and
its `prev`/`next` neighbors in the initialized-tick list — the raw material
for authoritative insert hints and range fee accounting. Hits the network
for one node request.

The `ticks` key is a BHP256 struct hash. Pass `{ poolKey, tick }` and the
client derives it locally (loading the optional `@provablehq/sdk` peer), or
pass a pre-derived `tickKey` to stay WASM-free — e.g. in a wallet-only
bundle.

## Usage

```ts
const tick = await client.getTick({ poolKey, tick: -600 })
if (tick) console.log(tick.liquidity_net, tick.prev, tick.next)

// Without the WASM peer:
const tick2 = await client.getTick({ tickKey })
```

## Returns

`Promise<Tick | null>`

The decoded tick, or `null` when the tick is not initialized.

- **pool** — `string`. The pool the tick belongs to.
- **liquidity_net** — `bigint`. Signed liquidity change when crossing (i128).
- **liquidity_gross** — `bigint`. Total liquidity referencing the tick (u128).
- **tick** — `number`. The tick index (i32).
- **fee_growth_outside0_64 / fee_growth_outside1_64** — `bigint`. Q64
  fee-growth-outside snapshots (u128).
- **prev / next** — `number`. Neighboring initialized ticks (i32).

## Parameters

### poolKey + tick

- **Type:** `string`, `number`

Pool key field literal and tick index (i32). The mapping key is derived
locally via `deriveTickKey` — requires the `@provablehq/sdk` peer.

### tickKey

- **Type:** `string`

A pre-derived tick key field literal. Mutually exclusive with
`poolKey`/`tick`; skips the local derivation entirely.

### program (optional)

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

Program to read from.
