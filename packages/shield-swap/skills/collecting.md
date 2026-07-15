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
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'
import type { SwapHandle, MultiHopSwapHandle } from '@provablehq/shield-swap-sdk'
import {
  loadSession,
  deserializeHandle,
  isMultiHopHandle,
  removeSwapHandle,
  buildDexImports,
} from '$SKILLS/scripts/session.js'

const { client, account, state } = await loadSession()
const tokens = (await client.api.getTokens()).data
const programOf = (tokenId: string) => tokens.find((t) => t.address === tokenId)?.wrapper_program

for (const stored of [...state.swapHandles]) {
  const handle = deserializeHandle(stored)
  const multiHop = isMultiHopHandle(stored) // multi-hop handles carry poolKeys
  const pIn = programOf(handle.tokenInId)
  const pOut = programOf(handle.tokenOutId)
  if (!pIn || !pOut) {
    console.error(`no wrapper program for swap ${handle.transactionId} tokens — keeping the handle`)
    continue
  }
  const imports = await buildDexImports(client, [pIn, pOut])

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = multiHop
        ? await client.claimMultiHopOutput({ handle: handle as MultiHopSwapHandle, imports })
        : await client.claimSwapOutput({ handle: handle as SwapHandle, imports })
      console.log(`claimed ${result.amountOut} of ${handle.tokenOutId} (tx ${result.transactionId})`)
      // Drop the handle the moment its claim confirms — never later, so a
      // crash between claims cannot resurrect an already-claimed handle.
      removeSwapHandle(handle.transactionId)
      break
    } catch (err) {
      if (err instanceof SwapOutputNotFinalizedError) {
        await new Promise((r) => setTimeout(r, 15_000)) // finalize lag — wait and retry
      } else {
        console.error(`claim failed for swap ${handle.swapId ?? handle.transactionId}:`, err)
        break // keep the handle — money in flight
      }
    }
  }
}
```

A handle leaves the state file ONLY at the moment its claim confirms
(`removeSwapHandle` right after success — not in a batch at the end). Never
delete an unclaimed handle: without it the output is unrecoverable.

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
import { floorToDust } from '$SKILLS/scripts/session.js'

const tokens = (await client.api.getTokens()).data
const decimalsOf = (wrapperProgram: string) => tokens.find((t) => t.wrapper_program === wrapperProgram)?.decimals ?? 0

for (const tracked of state.positions) {
  const position = await client.getPosition({ positionTokenId: tracked.positionTokenId })
  if (!position) continue

  // DUST TRAP: owed balances accrue in raw units, but withdrawals must be
  // representable at the token's scale — a request with non-zero dust
  // digits reverts at finalize (fee consumed, nothing collected). Floor
  // each request; the sub-scale remainder stays owed on the position.
  const amount0 = floorToDust(position.tokens_owed0, decimalsOf(tracked.token0Program))
  const amount1 = floorToDust(position.tokens_owed1, decimalsOf(tracked.token1Program))
  if (amount0 === 0n && amount1 === 0n) continue // nothing collectable yet

  const imports = await buildDexImports(client, [tracked.token0Program, tracked.token1Program])
  const { transactionId } = await client.collect({
    poolKey: tracked.poolKey,
    positionTokenId: tracked.positionTokenId, // REQUIRED with several positions in one pool
    amount0Requested: amount0,
    amount1Requested: amount1,
    imports,
  })
  console.log(`collected ${amount0}/${amount1} from ${tracked.positionTokenId} (tx ${transactionId})`)
}
```

Collecting everything representable is the normal move; fees keep accruing
while the position has in-range liquidity — sweep periodically. Owed
amounts below one unit of the token's scale are not collectable until more
accrues on top of them.

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
| `collect` reverts at finalize | Requested amount has dust digits below the token scale | Floor requests with `floorToDust(owed, decimals)`; sub-scale dust stays owed. |
| `collect` reverts | Zero owed, or position record not scannable yet | Re-read `getPosition`; wait for the scanner if the position was just changed. |
| Claimed record not in holdings | Scanner lag | Wait a few minutes; the record service indexes asynchronously. |
