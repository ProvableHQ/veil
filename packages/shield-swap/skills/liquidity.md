# Liquidity: mint, add, remove

Goal: open a concentrated-liquidity position on an existing pool, grow it,
shrink it, and (in [collecting.md](./collecting.md)) withdraw what it owes.
Prerequisite: [startup.md](./startup.md) passed, and the account holds BOTH
of the pool's tokens privately — minting deposits token0 and token1
together.

A position is a private PositionNFT record plus public state under its
`positionTokenId`. Track every minted `positionTokenId` in the state file;
it is the key to every later operation. A lost id is recoverable —
`client.getOwnedPositions()` re-discovers every owned position (id, pool,
range, live amounts, uncollected fees) from the account's records.

## Pick a pool and a range

```ts
import { roundTickToSpacing } from '@provablehq/shield-swap-sdk'
import { loadSession, saveState } from '@provablehq/shield-swap-cli/session'

const { client, account, state } = await loadSession()
const balances = await client.getBalances()

// A pool whose BOTH tokens the account holds privately, on a fee tier the
// CURRENT deployment registers. Two traps here:
//  - UNITS: the API's `pool.fee` is in basis points ("5"), the chain
//    registers tiers in pips (500) — read the fee from the on-chain pool
//    state, never convert the API's number.
//  - STALE TIERS: pools created before a redeployment can carry a fee the
//    current registry no longer lists; reading tick spacing for such a fee
//    can hang the node endpoint. ALWAYS gate on isFeeTierValid first.
const pools = (await client.api.getPools({ limit: 50 })).data
// Keyed by token id, so no scanning: getBalances already reconciled the
// registry against records and public balances.
const held = (id: string) => (balances[id]?.private ?? 0n) > 0n

let pool, slot: Awaited<ReturnType<typeof client.getSlot>>, spacing: number | null = null
for (const p of pools) {
  if (!held(p.token0) || !held(p.token1) || !p.token0_info?.amm_token_program || !p.token1_info?.amm_token_program) continue
  const poolState = await client.getPool({ poolKey: p.key })
  if (!poolState || !(await client.isFeeTierValid({ fee: poolState.fee }))) continue
  const s = await client.getSlot({ poolKey: p.key })
  if (!s || s.liquidity === 0n) continue
  spacing = await client.getFeeToTickSpacing({ fee: poolState.fee })
  if (!spacing) continue
  pool = p
  slot = s
  break
}
if (!pool || !slot || !spacing) throw new Error('no mintable pool: need both tokens held and a registered fee tier')

const tickLower = roundTickToSpacing(slot.tick - 10 * spacing, spacing)
const tickUpper = roundTickToSpacing(slot.tick + 10 * spacing, spacing)
```

The range MUST align to the pool's tick spacing (`roundTickToSpacing`) and
`tickLower < tickUpper`. A range that does not straddle `slot.tick` is
valid but earns nothing until price enters it.

## Mint the position

```ts

// The AMM-side token programs feed the imports ONLY. Do not pass them as
// `token0Program`/`token1Program` — those name the programs holding the
// caller's RECORDS, and for a wrapped token the records live in the
// UNDERLYING program, which the SDK resolves on chain by itself.
const p0 = pool.token0_info!.amm_token_program!
const p1 = pool.token1_info!.amm_token_program!
const imports = await client.resolveDexImports({ tokenPrograms: [p0, p1] })

// Deposit a small slice of each holding; the contract balances the two
// against the range and refunds the excess side as change. Deposits obey
const h0 = held(pool.token0)!
const h1 = held(pool.token1)!
const { positionTokenId, transactionId } = await client.mint({
  poolKey: pool.key,
  tickLower,
  tickUpper,
  amount0Desired: h0.privateAmount / 20n, // 5% of the holding
  amount1Desired: h1.privateAmount / 20n,
  // Both REQUIRED, no defaults. `withdrawal` is where collect pays out,
  // fixed for the position's life at mint — a cold payout address is a
  // deliberate choice here; for a self-custodied agent both are the account.
  recipient: account.address,
  withdrawal: account.address,
  imports,
})

// Nothing to persist: the position lives in a record the account holds, and
// `client.getOwnedPositions()` rediscovers it — with its pool, ticks, and what
// it can collect — on any later run or after a crash.
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
existing range. Pin the position with `positionTokenId` — without it the
PositionNFT record is auto-selected by pool, which is ambiguous the moment
a second position exists in the same pool.

```ts
await client.increaseLiquidity({
  poolKey: pool.key,
  positionTokenId, // pin the position — pool-only selection is ambiguous
  amount0Desired: extra0, // raw base units, bigint, dust-floored
  amount1Desired: extra1,
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
import { loadState, saveState } from '@provablehq/shield-swap-cli/session'

await client.decreaseLiquidity({ poolKey: pool.key, positionTokenId, liquidityToRemove: position!.liquidity })
// … collect per collecting.md until nothing representable remains
// (sub-scale dust can stay owed and may block the burn — see collecting.md) …
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
| Tick-spacing read hangs/times out | Pool's fee tier predates the current deployment (unregistered) | Gate pool selection on `isFeeTierValid` — never read spacing for an unvalidated fee. |
| Empty range after alignment | `tickLower === tickUpper` post-rounding | Widen the range to at least one spacing. |
| Mint reverts on amounts | Desired amounts far out of ratio for the range | Let the smaller side lead: size both from quotes around `slot.tick`. |
| `burn` rejected | Liquidity or owed balances remain | Decrease to zero and collect everything first. |
| Position reads `null` right after mint | Finalize/indexer lag | Poll `getPosition` for a few seconds. |
