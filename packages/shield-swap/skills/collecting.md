# Collecting: claim swap outputs and LP earnings

Goal: turn everything the account is owed into private records it holds —
outputs of past swaps, and the fees/withdrawals accrued on liquidity
positions. Prerequisite: [startup.md](./startup.md) passed; there are
handles in `state.swapHandles` and/or positions in `state.positions`.

Run this sweep after any swapping or liquidity session, and again after a
crash — the state file is the ledger of everything still claimable.

## Claim swap outputs

Every entry in `state.swapHandles` is money in flight. A swap's output is
claimable once the swap transaction finalizes; claiming before that throws
`SwapOutputNotFinalizedError` — expected, retry with backoff.

```ts
import { getProgram } from '@provablehq/veil-core'
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'
import { loadSession, deserializeHandle, saveState } from '$SKILLS/scripts/session.js'

const { client, account, state } = await loadSession()
const tokens = (await client.api.getTokens()).data
const programOf = (tokenId: string) => tokens.find((t) => t.address === tokenId)?.wrapper_program

const remaining: typeof state.swapHandles = []
for (const stored of state.swapHandles) {
  const handle = deserializeHandle(stored)
  const pIn = programOf(handle.tokenInId)!
  const pOut = programOf(handle.tokenOutId)!
  const imports = {
    [pIn]: await getProgram(client, { programId: pIn }),
    [pOut]: await getProgram(client, { programId: pOut }),
  }

  let claimed = false
  for (let attempt = 0; attempt < 10 && !claimed; attempt++) {
    try {
      const { amountOut, transactionId } = await client.claimSwapOutput({ handle, imports })
      console.log(`claimed ${amountOut} of ${handle.tokenOutId} (tx ${transactionId})`)
      claimed = true
    } catch (err) {
      if (err instanceof SwapOutputNotFinalizedError) {
        await new Promise((r) => setTimeout(r, 15_000)) // finalize lag — wait and retry
      } else {
        console.error(`claim failed for swap ${handle.swapId ?? handle.transactionId}:`, err)
        break
      }
    }
  }
  if (!claimed) remaining.push(stored) // keep unclaimed handles — money in flight
}
state.swapHandles = remaining
saveState(state)
```

A handle leaves the state file ONLY after its claim confirms. Never delete
an unclaimed handle: without it the output is unrecoverable.

## Collect liquidity earnings

Fees accrue into a position's `tokens_owed0/1`, and `decreaseLiquidity`
settles withdrawn principal into the same place. `collect` withdraws owed
balances to private records.

```ts
for (const tracked of state.positions) {
  const position = await client.getPosition({ positionTokenId: tracked.positionTokenId })
  if (!position || (position.tokens_owed0 === 0n && position.tokens_owed1 === 0n)) continue

  const imports = {
    [tracked.token0Program]: await getProgram(client, { programId: tracked.token0Program }),
    [tracked.token1Program]: await getProgram(client, { programId: tracked.token1Program }),
  }
  const { transactionId } = await client.collect({
    poolKey: tracked.poolKey,
    amount0Requested: position.tokens_owed0, // everything owed
    amount1Requested: position.tokens_owed1,
    imports,
  })
  console.log(`collected ${position.tokens_owed0}/${position.tokens_owed1} from ${tracked.positionTokenId} (tx ${transactionId})`)
}
```

Requesting more than is owed is clamped by the contract; requesting
everything owed is the normal move. Fees keep accruing while the position
has in-range liquidity — sweep periodically.

## Verify the take

After a sweep, the claimed and collected amounts appear as private records:

```ts
import { getHoldings } from '$SKILLS/scripts/session.js'
const holdings = await getHoldings(client, account.address)
for (const h of holdings) console.log(h.symbol, 'private', h.privateAmount)
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
