# Liquidity: mint, add, remove

Goal: open a concentrated-liquidity position on an existing pool, grow it,
shrink it, and (in [collecting.md](./collecting.md)) withdraw what it owes.
Prerequisite: [startup.md](./startup.md) passed, and the account holds BOTH
of the pool's tokens privately — minting deposits token0 and token1
together.

A position is a private PositionNFT record plus public state under its
`positionTokenId`. Track every minted `positionTokenId` in the state file;
it is the key to every later operation.

## Pick a pool and a range

```ts
import { roundTickToSpacing } from '@provablehq/shield-swap-sdk'
import { loadSession, getHoldings, saveState } from '$SKILLS/scripts/session.js'

const { client, account, state } = await loadSession()
const holdings = await getHoldings(client, account.address)

// A pool whose BOTH tokens the account holds privately.
const pools = (await client.api.getPools({ limit: 50 })).data
const held = (id: string) => holdings.find((h) => h.tokenId === id && h.privateAmount > 0n)
const pool = pools.find((p) => held(p.token0) && held(p.token1) && p.token0_info?.wrapper_program && p.token1_info?.wrapper_program)
if (!pool) throw new Error('no pool where the account holds both tokens — swap into the missing side first')

// Live state → a range straddling the current tick earns fees now.
// UNITS TRAP: the API's `pool.fee` is in basis points ("5"), but the chain
// registers fee tiers in pips (500). Read the fee from the on-chain pool
// state — chain values for chain calls, no unit guessing.
const slot = await client.getSlot({ poolKey: pool.key })
const poolState = await client.getPool({ poolKey: pool.key })
const spacing = await client.getFeeToTickSpacing({ fee: poolState!.fee })
if (!slot || !spacing) throw new Error('pool has no live slot or an unregistered fee tier')
const tickLower = roundTickToSpacing(slot.tick - 10 * spacing, spacing)
const tickUpper = roundTickToSpacing(slot.tick + 10 * spacing, spacing)
```

The range MUST align to the pool's tick spacing (`roundTickToSpacing`) and
`tickLower < tickUpper`. A range that does not straddle `slot.tick` is
valid but earns nothing until price enters it.

## Mint the position

```ts
import { appendPosition, buildDexImports, floorToDust } from '$SKILLS/scripts/session.js'

const p0 = pool.token0_info!.wrapper_program!
const p1 = pool.token1_info!.wrapper_program!
// Token programs + the DEX program's own declared imports.
const imports = await buildDexImports(client, [p0, p1])

// Deposit a small slice of each holding; the contract balances the two
// against the range and refunds the excess side as change. Deposits obey
// the same no-dust rule as swaps — always floor.
const h0 = held(pool.token0)!
const h1 = held(pool.token1)!
const { positionTokenId, transactionId } = await client.mint({
  poolKey: pool.key,
  tickLower,
  tickUpper,
  amount0Desired: floorToDust(h0.privateAmount / 20n, h0.decimals), // 5%, dust-safe
  amount1Desired: floorToDust(h1.privateAmount / 20n, h1.decimals),
  token0Program: p0,
  token1Program: p1,
  imports,
})

// PERSIST IMMEDIATELY — the id is the key to the position.
appendPosition({
  positionTokenId: positionTokenId!,
  poolKey: pool.key,
  token0Program: p0,
  token1Program: p1,
  openedAt: new Date().toISOString(),
})
console.log('minted position', positionTokenId, 'tx', transactionId)
```

Verify once the transaction settles (public state lags finalize by a few
seconds — poll):

```ts
const position = await client.getPosition({ positionTokenId })
// position.liquidity > 0n, position.tick_lower / tick_upper match the range
```

## Add liquidity to an existing position

`increaseLiquidity` deposits more of both tokens into the position's
existing range. The PositionNFT record is auto-selected **by pool** — the
action has no `positionTokenId` parameter, so with more than one position
in the same pool its target is ambiguous. Keep ONE position per pool when
using it; otherwise treat the second position as its own mint/decrease
lifecycle.

```ts
await client.increaseLiquidity({
  poolKey: pool.key,
  amount0Desired: extra0, // raw base units, bigint, dust-floored
  amount1Desired: extra1,
  token0Program: p0,
  token1Program: p1,
  imports, // same two program sources as mint
})
```

## Remove liquidity

`decreaseLiquidity` burns liquidity in place: the withdrawn amounts settle
into the position's `tokens_owed0/1`, they do NOT return to the wallet yet.
Collect them afterwards ([collecting.md](./collecting.md)).

```ts
const position = await client.getPosition({ positionTokenId })
await client.decreaseLiquidity({
  poolKey: pool.key,
  positionTokenId, // pin the position — pool-only selection is ambiguous
  liquidityToRemove: position!.liquidity / 2n, // remove half
  // amount0Min/amount1Min optional — slippage floors for the withdrawal
})
```

Full exit = decrease everything, collect everything, then `burn`:

```ts
import { loadState, saveState } from '$SKILLS/scripts/session.js'

await client.decreaseLiquidity({ poolKey: pool.key, positionTokenId, liquidityToRemove: position!.liquidity })
// … collect per collecting.md until tokens_owed0/1 are zero …
await client.burn({ poolKey: pool.key, positionTokenId })
// then drop it from the tracked positions (fresh read-modify-write)
const latest = loadState()
latest.positions = latest.positions.filter((p) => p.positionTokenId !== positionTokenId)
saveState(latest)
```

`burn` requires an empty position — zero liquidity AND zero owed.

## Failure modes

| Symptom | Cause | Remedy |
| --- | --- | --- |
| No covering record for a deposit | The account holds too little of one token privately | Swap into the missing side first, or shrink the desired amounts. |
| Empty range after alignment | `tickLower === tickUpper` post-rounding | Widen the range to at least one spacing. |
| Mint reverts on amounts | Desired amounts far out of ratio for the range | Let the smaller side lead: size both from quotes around `slot.tick`. |
| `burn` rejected | Liquidity or owed balances remain | Decrease to zero and collect everything first. |
| Position reads `null` right after mint | Finalize/indexer lag | Poll `getPosition` for a few seconds. |
