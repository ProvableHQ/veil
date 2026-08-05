/**
 * Swap status — what is owed, what settled, and claiming what is still waiting.
 *
 * A private swap takes two transactions: the request, then a claim that collects
 * the output. Between them the proceeds sit in `swap_outputs` under a blinded
 * identity only this account can prove ownership of, and the handle needed to
 * claim them lives in the identity store the session configures.
 *
 * This is the sweep. It reads the chain rather than the store's own statuses, so
 * an entry appears exactly when a claim would succeed.
 *
 *   --reconcile   walk `claim_swap_output` history to recover a store that lost
 *                 track of a swap. Expensive; run it after losing a store, not
 *                 routinely.
 *   --claim       claim what is owed (requires --execute).
 *
 * Usage:
 *   npx tsx swap-history.ts                              # what is owed
 *   npx tsx swap-history.ts --claim --execute            # claim everything claimable
 *   npx tsx swap-history.ts --claim <swapId> --execute   # claim one
 *   npx tsx swap-history.ts --reconcile                  # rebuild from chain history
 *   npx tsx swap-history.ts --json
 */
import {
  SwapOutputNotFinalizedError,
  deriveBlindedAddress,
  deriveBlindingFactor,
  viewKeyToScalar,
} from '@provablehq/shield-swap-sdk'
import type { BlindedIdentityRecord, BlindedIdentityStore } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from './session.js'
import { flags, setJsonMode, step, done, warn, output, confirmed, run } from './cli.js'

const USAGE = `swap-history.ts — unclaimed swap outputs, reconciliation, and claiming

  --network <testnet|mainnet>   default testnet
  --claim [swapId]              claim one or (with no value) everything claimable
  --reconcile                   rebuild the store: discover the account's used
                                identities, then recover their swap ids from
                                chain history
  --window <n>                  identities to probe ahead of the tip, default 16
  --pages <n>                   history pages for --reconcile, default 8
  --execute                     actually submit claims
  --json                        machine-readable output`

const args = flags(
  {
    claim: { type: 'string' },
    reconcile: { type: 'boolean' },
    pages: { type: 'string' },
    window: { type: 'string' },
  },
  USAGE,
)
setJsonMode(!!args.json)
// `--claim` with no value parses as an empty string, which means "all".
const claimAll = args.claim === ''
const claimOne = typeof args.claim === 'string' && args.claim !== '' ? args.claim : undefined
const wantsClaim = claimAll || !!claimOne

/**
 * Populates the store with identities this account has already consumed.
 *
 * A blinded identity is derived, not recorded: nothing on chain lists an
 * account's identities, and the account cannot enumerate its own. So a store that
 * starts empty — a first run, or a lost file — knows nothing, and
 * `reconcileSwapHistory` has no addresses to match history against.
 *
 * The only way back is to re-derive. Counters are sequential from 0, so this
 * walks forward from the store's tip deriving each address and asking
 * `used_blinded_addresses` whether this account has spent it. A window of hits
 * extends the search, because gaps are normal — a reverted or dropped swap burns
 * a counter without consuming its address.
 *
 * Recorded as `swapped` with no swap id, which is what they are: consumed on
 * chain, with their proceeds unlocatable until `reconcileSwapHistory` finds the
 * claim that names them.
 *
 * @param client A composed client with a local account.
 * @param viewKey The account's view key, for derivation.
 * @param signer The account address the identities are scoped to.
 * @param store The store to populate.
 * @param window Counters to probe past the last hit. Default 16.
 * @returns The identities discovered, in counter order.
 */
export async function discoverIdentities(
  client: Awaited<ReturnType<typeof loadSession>>['client'],
  viewKey: string,
  signer: string,
  store: BlindedIdentityStore,
  window = 16,
): Promise<BlindedIdentityRecord[]> {
  const existing = await store.load()
  const known = new Set(existing.map((record) => record.counter))
  const viewKeyScalar = await viewKeyToScalar(viewKey)
  const tip = existing.length ? Math.max(...existing.map((record) => record.counter)) : -1

  const found: BlindedIdentityRecord[] = []
  let counter = tip + 1
  let sinceHit = 0
  // Bounded so a wrong view key or program cannot walk forever.
  const CEILING = 4096

  while (sinceHit < window && counter < CEILING) {
    if (known.has(counter)) {
      counter++
      continue
    }
    const blindingFactor = await deriveBlindingFactor(viewKeyScalar, counter)
    const blindedAddress = await deriveBlindedAddress(blindingFactor, signer)
    if (await client.isBlindedAddressUsed({ address: blindedAddress })) {
      step(`counter ${counter} was used by this account`)
      found.push({ counter, blindingFactor, blindedAddress, status: 'swapped' })
      sinceHit = 0
    } else {
      sinceHit++
    }
    counter++
  }

  if (found.length) await store.save([...existing, ...found])
  return found
}

await run(async () => {
  const { client, account, network, blindedIdentities } = await loadSession({
    network: args.network as string | undefined,
  })
  if (!account.viewKey) throw new Error('this script needs a local account — a wallet tracks its own identities')
  done(`session on ${network}`)

  if (args.reconcile) {
    // Discovery first: history can only be matched against addresses we hold, so
    // an empty store has to be populated before the walk has anything to find.
    const window = args.window ? Number(args.window) : 16
    step(`probing for used identities, ${window} past the last hit`)
    const discovered = await discoverIdentities(
      client,
      account.viewKey!,
      account.address,
      blindedIdentities,
      window,
    )
    done(
      discovered.length
        ? `discovered ${discovered.length} identity(ies) this account has used`
        : 'no unrecorded identities found',
    )

    const pages = args.pages ? Number(args.pages) : 8
    step(`walking up to ${pages} pages of claim history — this is the expensive path`)
    const result = await client.reconcileSwapHistory({ maxPages: pages })
    done(
      `scanned ${result.callsScanned} calls over ${result.pagesScanned} page(s); ` +
        `recovered ${result.claims.length} claim(s)`,
    )
    if (!result.complete) {
      warn(`history was not exhausted — older claims may exist, re-run with --pages ${pages * 4}`)
    }
  }

  // Counted here rather than at startup: --reconcile populates the store, and a
  // count taken before that would report "nothing tracked" in the same run that
  // reports what it found.
  const records = await blindedIdentities.load()
  const tracked = records.length
  step(`reading swap_outputs for ${tracked} tracked identity(ies)`)
  const owed = await client.getUnclaimedSwaps()
  const tokens = await client.listTokens()
  const infoOf = (id: string) => tokens.find((token) => token.id === id)

  const rows = owed.swaps.map((swap) => {
    const out = infoOf(swap.output.token_out)
    const back = infoOf(swap.output.token_in)
    return {
      swapId: swap.swapId,
      blindedAddress: swap.blindedAddress,
      claimable: swap.claimable,
      tokenOut: out?.symbol ?? swap.output.token_out,
      amountOut: swap.output.amount_out,
      decimalsOut: out?.decimals ?? 0,
      tokenIn: back?.symbol ?? swap.output.token_in,
      amountRemaining: swap.output.amount_remaining,
      decimalsIn: back?.decimals ?? 0,
    }
  })

  const target = claimOne ? rows.filter((row) => row.swapId === claimOne) : rows
  if (claimOne && !target.length) {
    throw new Error(`swap ${claimOne} is not owed anything — it may already be claimed.`)
  }

  const claimed: Array<{ swapId: string; transactionId: string; amountOut: string }> = []
  if (wantsClaim) {
    const claimable = target.filter((row) => row.claimable)
    if (!claimable.length) {
      warn('nothing claimable: no stored handle for the owed swaps (try --reconcile)')
    } else if (
      confirmed({
        execute: args.execute as boolean | undefined,
        network,
        plan: claimable.map(
          (row) =>
            `claim ${formatAmount(row.amountOut, row.decimalsOut, row.tokenOut)} from swap ${row.swapId.slice(0, 16)}…`,
        ),
      })
    ) {
      for (const row of claimable) {
        const swap = owed.swaps.find((entry) => entry.swapId === row.swapId)!
        const pIn = infoOf(swap.output.token_in)?.ammTokenProgram
        const pOut = infoOf(swap.output.token_out)?.ammTokenProgram
        if (!pIn || !pOut) {
          warn(`skipping ${row.swapId}: no wrapper program for one of its tokens`)
          continue
        }
        const imports = await client.resolveDexImports({ tokenPrograms: [pIn, pOut] })

        // The output becomes claimable a few blocks after the swap confirms, so
        // an early attempt is expected to fail rather than exceptional.
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            step(`claiming ${row.swapId.slice(0, 16)}… (attempt ${attempt + 1})`)
            const result = await client.claimSwapOutput({ handle: swap.handle!, imports })
            done(
              `claimed ${formatAmount(result.amountOut, row.decimalsOut, row.tokenOut)} (tx ${result.transactionId})`,
            )
            claimed.push({
              swapId: row.swapId,
              transactionId: result.transactionId,
              amountOut: result.amountOut.toString(),
            })
            break
          } catch (error) {
            if (!(error instanceof SwapOutputNotFinalizedError)) throw error
            step('not finalized yet — waiting 15s')
            await new Promise((resolve) => setTimeout(resolve, 15_000))
          }
        }
      }
    }
  }

  // The history is the point of the script, so it prints whatever else happened —
  // a failed claim or an exhausted page budget still leaves a picture worth
  // seeing, and a caller hunting for funds needs the whole ledger, not a summary.
  const history = [...records]
    .sort((a, b) => a.counter - b.counter)
    .map((record) => ({
      counter: record.counter,
      status: record.status,
      swapId: record.swapId ?? null,
      hasHandle: !!record.handle,
      blindedAddress: record.blindedAddress,
    }))

  output(
    {
      network,
      tracked,
      history,
      owed: rows,
      totals: owed.totals,
      unresolvable: owed.unresolvable.length,
      claimed,
    },
    (data) => {
      if (data.history.length) {
        console.log(`\nidentity history on ${data.network}:\n`)
        for (const entry of data.history) {
          const swap = entry.swapId ? `${entry.swapId.slice(0, 18)}…` : '(no swap id)'
          // The handle is what makes an unclaimed swap claimable, so its absence
          // is worth showing next to the status rather than buried.
          const handle = entry.hasHandle ? 'handle' : entry.status === 'swapped' ? 'NO HANDLE' : ''
          console.log(
            `  #${String(entry.counter).padStart(4)}  ${entry.status.padEnd(9)} ${swap.padEnd(21)} ${handle}`,
          )
        }
      }
    if (!data.owed.length) {
      if (data.tracked === 0) {
        console.log(
          '\nThis store tracks no identities yet, so there is nothing to look for. A swap made ' +
            'through these scripts records itself; for an account with history, ' +
            '`--reconcile` rebuilds the store from chain.',
        )
      } else if (data.unresolvable) {
        // Not "all settled": these were used but cannot be looked up, so whether
        // they hold proceeds is unknown rather than answered.
        console.log(
          `\nNothing claimable across ${data.tracked} tracked identity(ies), but ` +
            `${data.unresolvable} of them cannot be checked — see below.`,
        )
      } else {
        console.log(`\nNothing owed across ${data.tracked} tracked identity(ies) — all settled.`)
      }
    } else {
      console.log(`\n${data.owed.length} unclaimed swap(s) on ${data.network}:\n`)
      for (const row of data.owed) {
        const mark = row.claimable ? ' ' : '×'
        console.log(
          `${mark} ${formatAmount(row.amountOut, row.decimalsOut, row.tokenOut).padStart(24)}` +
            (row.amountRemaining > 0n
              ? ` + ${formatAmount(row.amountRemaining, row.decimalsIn, row.tokenIn)} refund`
              : ''),
        )
        console.log(`    swap ${row.swapId}`)
      }
      const blocked = data.owed.filter((row) => !row.claimable).length
      if (blocked) {
        console.log(`\n× ${blocked} owed but not claimable here: no stored handle. Try --reconcile.`)
      }
    }
    if (data.unresolvable) {
      warn(
        `${data.unresolvable} identity(ies) were used by this account but have no swap id on file, so ` +
          'their swap cannot be looked up: it is unknown whether those swaps were already claimed or ' +
          'still hold proceeds.',
      )
      warn(
        'Most are usually old swaps already claimed, found by walking further back: ' +
          '`--reconcile --pages 64`. Any that were never claimed cannot be claimed from here — a claim ' +
          'needs the whole handle, and chain history names the swap without it.',
      )
    }
    if (!wantsClaim && data.owed.some((row) => row.claimable)) {
      console.log('\nRun with --claim --execute to collect.')
    }
    },
  )
})
