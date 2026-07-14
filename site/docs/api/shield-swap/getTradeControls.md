---
sidebar_position: 14
---

# getTradeControls

Reads every control gate that can block trading a pool, in one call.

The contract gates every swap behind admin controls — a global pause,
per-token pauses, per-pair pauses, and the pool's `enabled` flag — and
asserts them at finalize, where a violation costs a proved, fee-paid revert.
`getTradeControls` reads the pool, fans out the gate reads concurrently, and
reports the same conjunction the finalize checks. Hits the network for the
pool read plus six concurrent mapping reads.

Control state can change before a transaction finalizes — treat a green read
as advisory, not a guarantee.

## Usage

```ts
const controls = await client.getTradeControls({ poolKey })
if (!controls.tradeable) {
  console.log('blocked:', controls)   // which gate, exactly
}
```

## Returns

`Promise<GetTradeControlsReturnType>`

- **globalPaused** — `boolean`. Whether the whole program is paused.
- **poolEnabled** — `boolean`. The pool's own `enabled` flag.
- **token0 / token1** — `{ tokenId: string; allowed: boolean; paused: boolean }`.
  Each token's gates. The allowlist gates `create_pool` only — it is
  reported for completeness but does not affect `tradeable`.
- **pairPaused** — `boolean`. Whether the token pair is paused (all fee
  tiers).
- **tradeable** — `boolean`. The conjunction of the gates the swap finalize
  actually asserts: not globally paused, pool enabled, neither token paused,
  pair not paused.

## Parameters

### poolKey

- **Type:** `string`

Pool key field literal. Throws when no pool exists under the key.

### program (optional)

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

Program to read from.

## Individual readers

Each gate also reads on its own, with the contract's absent-entry defaults
(`false` everywhere; a value read returns `null` when absent):
`isGlobalPaused()`, `isTokenPaused({ tokenId })`,
`isPairPaused({ token0, token1 })` (order-independent),
`isTokenAllowed({ tokenId })` (gates pool creation, not trading),
`isPoolCreationOpen()`, `getFrozenPosition({ positionTokenId })` (a frozen
position blocks liquidity operations; returns the freeze block height), and
`getTokenDecimals({ tokenId })` (the registered decimal count that feeds the
no-dust rule).
