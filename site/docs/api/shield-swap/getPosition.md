---
sidebar_position: 12
---

# getPosition

Reads a position's public state from the on-chain `positions` mapping.

Returns the range, live liquidity, fee-growth snapshots, and the
`tokens_owed` balances that
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity) and fee accrual
settle into — the read that reconciles a position after liquidity
operations. The mapping key is the position's token id itself, so no local
hashing (or WASM peer) is involved. Needs only a transport; hits the network
for one node request.

## Usage

```ts
const position = await client.getPosition({ positionTokenId })
if (position) console.log(position.liquidity, position.tokens_owed0, position.tokens_owed1)
```

## Returns

`Promise<Position | null>`

The decoded position, or `null` when no position exists under the id (a
burned position's entry is removed).

- **token_id** — `string`. The position's token id (field literal).
- **pool** — `string`. The pool key the position provides liquidity to.
- **tick_lower / tick_upper** — `number`. The range bounds (i32).
- **liquidity** — `bigint`. Live liquidity (u128).
- **fee_growth_inside0_last_64 / fee_growth_inside1_last_64** — `bigint`.
  Q64 fee-growth snapshots from the last position update (u128).
- **tokens_owed0 / tokens_owed1** — `bigint`. Settled amounts collectable
  with [`collect`](/api/shield-swap/collect) (u128).

## Parameters

### positionTokenId

- **Type:** `string`

The position's `token_id` field literal — from
[`mint`](/api/shield-swap/mint)'s return, a PositionNFT record, or
`derivePositionTokenId`.

### program (optional)

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

Program to read from.
