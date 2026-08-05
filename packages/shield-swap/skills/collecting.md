# Collecting: claim swap outputs and LP earnings

Goal: turn everything the account is owed into private records it holds —
outputs of past swaps, and the fees/withdrawals accrued on liquidity
positions. Prerequisite: [startup.md](./startup.md) passed.

Run this sweep after any swapping or liquidity session, and again after a
crash. The blinded identity store is the ledger of everything still claimable,
and the client writes to it on every swap without being asked.

## Claim swap outputs

`getUnclaimedSwaps` is the sweep. It reads `swap_outputs` on chain rather than
trusting stored statuses, so an entry appears exactly when a claim would
succeed, and each one carries the handle rebuilt from the store — which is what
lets a later process claim a swap it did not make.

```ts
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from '$SKILLS/scripts/session.js'

const { client } = await loadSession()
const tokens = (await client.api.getTokens()).data
const programOf = (tokenId: string) => tokens.find((t) => t.address === tokenId)?.amm_token_program
const infoOf = (tokenId: string) => tokens.find((t) => t.address === tokenId)

const { swaps, totals, unresolvable } = await client.getUnclaimedSwaps()
for (const [tokenId, amount] of Object.entries(totals)) {
  const info = infoOf(tokenId)
  console.log(`owed: ${formatAmount(amount, info?.decimals ?? 0, info?.symbol)}`)
}

for (const swap of swaps) {
  if (!swap.claimable) {
    // No stored handle, so this one cannot be claimed from the store. It is
    // still visible on chain; whoever holds the handle can claim it.
    console.error(`swap ${swap.swapId} is owed but has no stored handle`)
    continue
  }
  const pIn = programOf(swap.output.token_in)
  const pOut = programOf(swap.output.token_out)
  if (!pIn || !pOut) {
    console.error(`no wrapper program for swap ${swap.swapId} tokens — skipping`)
    continue
  }
  const imports = await client.resolveDexImports({ tokenPrograms: [pIn, pOut] })

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // One claim serves both single- and multi-hop swaps; it accepts either
      // handle type and routes the withdrawal (wrapped vs plain) internally.
      const result = await client.claimSwapOutput({ handle: swap.handle!, imports })
      const out = infoOf(swap.output.token_out)
      console.log(`claimed ${formatAmount(result.amountOut, out?.decimals ?? 0, out?.symbol)} (tx ${result.transactionId})`)
      break
    } catch (err) {
      if (err instanceof SwapOutputNotFinalizedError) {
        await new Promise((r) => setTimeout(r, 15_000)) // finalize lag — wait and retry
      } else {
        console.error(`claim failed for swap ${swap.swapId}:`, err)
        break // leave it in the store — money in flight
      }
    }
  }
}
```

Nothing has to be deleted afterwards: `claimSwapOutput` marks the identity
`claimed` in the store itself, and the next sweep reads the chain again rather
than trusting that mark. A claim that lands but fails to update the store logs
a warning and continues, because the funds are already in the account.

`unresolvable` is the one case needing attention: identities the chain has
consumed whose swap id the store never recorded. Nothing on chain locates their
proceeds until a claim exists.

For a store that is merely missing some ids, `client.reconcileSwapHistory()` walks
`claim_swap_output` history and recovers them. For a store that is **empty** — a
first run against an existing account, or a lost file — that walk has nothing to
match against, because a blinded identity is derived rather than recorded and
nothing on chain lists an account's own. Use the script instead:

```sh
npx tsx scripts/swaps.ts --reconcile --pages 32
```

It re-derives candidate identities from the view key, asks
`used_blinded_addresses` which ones this account has already spent, writes those
to the store, and only then walks history to attach swap ids. Rebuilding one
testnet account this way recovered 36 identities and 22 swap ids from an empty
file.

Handles cannot be recovered this way — a claim call names the swap but not the
whole preimage a claim consumes — so a recovered identity with unclaimed proceeds
is visible but not claimable. That is the argument for a durable store rather
than relying on recovery.

One ambiguity to know about: `getSwapOutput` reads `null` both before the
swap finalizes AND after a successful claim consumed the output. If a sweep
keeps hitting `SwapOutputNotFinalizedError` on an old handle for more than
~5 minutes, check `handle.transactionId` on chain — a swap that was itself
rejected has nothing to claim, and a handle whose claim already confirmed
in a crashed run can be dropped once the claimed record shows up in
holdings.

## Collect liquidity earnings

Fees accrue into a position's `tokens_owed0/1`, and `decreaseLiquidity`
settles withdrawn principal into the same place. `collect` withdraws owed
balances to private records.

```ts
import { formatAmount } from '$SKILLS/scripts/session.js'

const tokens = (await client.api.getTokens()).data
const tokenOf = (program: string) => tokens.find((t) => t.amm_token_program === program)
const decimalsOf = (program: string) => tokenOf(program)?.decimals ?? 0

// Positions are discovered from the account's records, not from a local list:
// `getOwnedPositions` joins each one with chain state, including what it could
// collect right now, so there is nothing to keep in sync.
for (const owned of await client.getOwnedPositions()) {
  // `state` is null only while a fresh mint has not finalized yet.
  if (!owned.state) continue

  // Owed balances accrue in raw base units; collect requests them directly
  // (the dust-flooring rule of the old stack is gone).
  const amount0 = owned.state.tokensOwed0
  const amount1 = owned.state.tokensOwed1
  if (amount0 === 0n && amount1 === 0n) continue // nothing collectable yet

  const p0 = tokens.find((t) => t.address === owned.token0Id)?.amm_token_program
  const p1 = tokens.find((t) => t.address === owned.token1Id)?.amm_token_program
  if (!p0 || !p1) continue
  const imports = await client.resolveDexImports({ tokenPrograms: [p0, p1] })
  const { transactionId } = await client.collect({
    poolKey: owned.poolKey,
    positionTokenId: owned.positionTokenId, // REQUIRED with several positions in one pool
    amount0Requested: amount0,
    amount1Requested: amount1,
    imports,
  })
  const t0 = tokenOf(p0)
  const t1 = tokenOf(p1)
  console.log(
    `collected ${formatAmount(amount0, t0?.decimals ?? 0, t0?.symbol)} + ` +
      `${formatAmount(amount1, t1?.decimals ?? 0, t1?.symbol)} (tx ${transactionId})`,
  )
}
```

Collecting everything owed is the normal move; fees keep accruing while the
position has in-range liquidity — sweep periodically.

## Verify the take

After a sweep, the claimed and collected amounts appear as private records:

```ts
import { formatAmount } from '$SKILLS/scripts/session.js'
const balances = await client.getBalances()
for (const b of Object.values(balances)) console.log(formatAmount(b.private, b.decimals, b.symbol), 'private')
```

The record scanner indexes new records asynchronously — allow a few
minutes before treating a missing balance bump as a failure.

## Failure modes

| Symptom | Cause | Remedy |
| --- | --- | --- |
| `SwapOutputNotFinalizedError` persists past ~5 min | Swap tx rejected, or never confirmed | Look up `handle.transactionId` on chain; a rejected swap has nothing to claim — keep the handle and investigate. |
| Claim reverts (not the finalize error) | Wrong imports, or output already claimed | Rebuild imports from BOTH tokens' wrapper programs; check `getSwapOutput({ swapId })` — `null` after a prior claim is normal. |
| `collect` reverts | Zero owed, or position record not scannable yet | Re-read `getPosition`; wait for the scanner if the position was just changed. |
| Claimed record not in holdings | Scanner lag | Wait a few minutes; the record service indexes asynchronously. |
