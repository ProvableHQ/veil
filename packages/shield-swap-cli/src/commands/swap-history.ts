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
 *   shield-swap history                              # what is owed
 *   shield-swap history --claim --execute            # claim everything claimable
 *   shield-swap history --claim --swap-id <id> --execute   # claim one
 *   shield-swap history --reconcile                  # rebuild from chain history
 *   shield-swap history --json
 */
import {
  SwapOutputNotFinalizedError,
  deriveBlindedAddress,
  deriveBlindingFactor,
  viewKeyToScalar,
} from '@provablehq/shield-swap-sdk'
import type { BlindedIdentityRecord, BlindedIdentityStore } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from '../session.js'
import { flags, step, done, warn, output, confirmed, run } from '../shared.js'

const USAGE = `shield-swap history — unclaimed swap outputs, reconciliation, and claiming

  --network <testnet|mainnet>   default testnet
  --claim                       claim everything claimable
  --swap-id <id>                with --claim, claim just this swap
  --reconcile                   force a full re-search even when the local history
                                looks complete (discovery runs either way)
  --no-search                   never walk history, however incomplete it looks
  --window <n>                  identities to probe past the last known swap id,
                                default 16
  --pages <n>                   bound the history walk; default is the whole
                                history, which ends when the history does
  --execute                     actually submit claims
  --json                        machine-readable output`

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

/**
 * Runs the `history` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags(
    {
      claim: { type: 'boolean' },
      'swap-id': { type: 'string' },
      reconcile: { type: 'boolean' },
      'no-search': { type: 'boolean' },
      pages: { type: 'string' },
      window: { type: 'string' },
    },
    USAGE,
    argv,
  )
  // Boolean rather than an optional value: `--claim --execute` is ambiguous to
  // parseArgs, which reads the next flag as the value.
  const claimOne = typeof args['swap-id'] === 'string' ? (args['swap-id'] as string) : undefined
  const wantsClaim = !!args.claim || !!claimOne

  await run(async () => {
    const { client, account, network, blindedIdentities } = await loadSession({
      network: args.network as string | undefined,
    })
    if (!account.viewKey) throw new Error('this script needs a local account — a wallet tracks its own identities')
    done(`session on ${network}`)

    // Whether the advice below can honestly say "look further back".
    let walkedEverything = false

    // Discovery is cheap and always worth doing: it is a handful of derivations and
    // mapping reads, and without it a new or lost store has nothing to reconcile.
    {
      const window = args.window ? Number(args.window) : 16
      step(`probing for used identities, ${window} past the last known swap id`)
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
    }

    // The walk is the expensive part, so it runs only when the local history is
    // actually missing something. A record marked `claimSearched` has already been
    // looked for across the whole history and was not there — searching again would
    // cost the same and find the same nothing.
    const stored = await blindedIdentities.load()
    const missing = stored.filter(
      (record) => !record.swapId && record.status !== 'reserved' && !record.claimSearched,
    )
    if (args['no-search']) {
      if (missing.length) warn(`${missing.length} identity(ies) lack a swap id; --no-search skipped the lookup`)
    } else if (missing.length || args.reconcile) {
      step(
        missing.length
          ? `${missing.length} identity(ies) have no swap id — searching claim history`
          : 're-searching claim history because --reconcile was passed',
      )
      step(
        args.pages
          ? `walking up to ${args.pages} pages of claim history`
          : 'walking the whole claim history — it ends when the history does',
      )
      const result = await client.reconcileSwapHistory(args.pages ? { maxPages: Number(args.pages) } : {})
      walkedEverything = result.complete
      done(
        `scanned ${result.callsScanned} calls over ${result.pagesScanned} page(s); ` +
          `recovered ${result.claims.length} claim(s) and ${result.requests.length} request(s)`,
      )
      const claimable = result.requests.filter((request) => request.handle).length
      if (claimable) {
        done(`${claimable} abandoned swap(s) rebuilt with a claimable handle — see --claim`)
      }
      if (!result.complete) {
        warn('the walk stopped before the history ended — raise or drop --pages to finish it')
      }
    } else {
      // Nothing to look for: every consumed identity either has its swap id or has
      // already been searched for across the whole history.
      walkedEverything = true
      done('local history is complete — no need to search chain')
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
              [
                `claim ${formatAmount(row.amountOut, row.decimalsOut, row.tokenOut)}`,
                `from swap ${row.swapId.slice(0, 16)}…`,
              ] as const,
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
    const symbolOf = (tokenId: string) => infoOf(tokenId)?.symbol ?? `${tokenId.slice(0, 8)}…`
    const decimalsOf = (tokenId: string) => infoOf(tokenId)?.decimals ?? 0

    const history = [...records]
      .sort((a, b) => a.counter - b.counter)
      .map((record) => {
        // The handle knows what was sold; the claim knows what came back. Either can
        // be absent — a recovered identity has neither — so both are nullable rather
        // than defaulted to zero, which would read as "sold nothing".
        const handle = record.handle
        const claim = record.claim
        const tokenIn = claim?.tokenIn ?? handle?.tokenInId ?? null
        const tokenOut = claim?.tokenOut ?? handle?.tokenOutId ?? null
        return {
          counter: record.counter,
          status: record.status,
          swapId: record.swapId ?? null,
          pair: tokenIn && tokenOut ? `${symbolOf(tokenIn)}→${symbolOf(tokenOut)}` : null,
          // The handle when it survived, else the request's public `amount_in`,
          // which the history walk recovers for a store that lost its handles.
          sold:
            handle || (record.soldAmountIn && tokenIn)
              ? {
                  amount: BigInt(handle?.amountIn ?? record.soldAmountIn!),
                  decimals: decimalsOf(handle?.tokenInId ?? tokenIn!),
                  symbol: symbolOf(handle?.tokenInId ?? tokenIn!),
                }
              : null,
          received: claim ? { amount: BigInt(claim.amountOut), decimals: decimalsOf(claim.tokenOut), symbol: symbolOf(claim.tokenOut) } : null,
          refunded:
            claim && BigInt(claim.amountRemaining) > 0n
              ? { amount: BigInt(claim.amountRemaining), decimals: decimalsOf(claim.tokenIn), symbol: symbolOf(claim.tokenIn) }
              : null,
          block: claim?.blockNumber ?? null,
          hasHandle: !!handle,
          claimSearched: !!record.claimSearched,
          blindedAddress: record.blindedAddress,
        }
      })

    // Collated from the persisted claims rather than a fresh walk: the claim
    // deleted its `swap_outputs` entry, so what a swap moved is only knowable from
    // the record reconcile wrote.
    const settled = records.filter((record) => record.claim)
    const received: Record<string, bigint> = {}
    const refunded: Record<string, bigint> = {}
    const pairs: Record<string, number> = {}
    for (const record of settled) {
      const claim = record.claim!
      received[claim.tokenOut] = (received[claim.tokenOut] ?? 0n) + BigInt(claim.amountOut)
      if (BigInt(claim.amountRemaining) > 0n) {
        refunded[claim.tokenIn] = (refunded[claim.tokenIn] ?? 0n) + BigInt(claim.amountRemaining)
      }
      const inSymbol = infoOf(claim.tokenIn)?.symbol ?? claim.tokenIn.slice(0, 10)
      const outSymbol = infoOf(claim.tokenOut)?.symbol ?? claim.tokenOut.slice(0, 10)
      const pair = `${inSymbol}→${outSymbol}`
      pairs[pair] = (pairs[pair] ?? 0) + 1
    }

    output(
      {
        network,
        tracked,
        walkedEverything,
        summary: {
          settled: settled.length,
          unrecorded: records.filter((record) => !record.claim && record.status !== 'reserved').length,
          pairs,
          received,
          refunded,
        },
        history,
        owed: rows,
        totals: owed.totals,
        unresolvable: owed.unresolvable.length,
        claimed,
      },
      (data) => {
        if (data.history.length) {
          console.log(`\nswaps so far on ${data.network}:\n`)
          const header = ['#', 'pair', 'sold', 'received', 'block', 'status', 'note']
          const rows = data.history.map((entry) => [
            String(entry.counter),
            entry.pair ?? '—',
            entry.sold ? formatAmount(entry.sold.amount, entry.sold.decimals, entry.sold.symbol) : '—',
            entry.received
              ? formatAmount(entry.received.amount, entry.received.decimals, entry.received.symbol) +
                (entry.refunded
                  ? ` (+${formatAmount(entry.refunded.amount, entry.refunded.decimals, entry.refunded.symbol)} back)`
                  : '')
              : '—',
            entry.block === null ? '—' : String(entry.block),
            entry.status,
            // The handle is what makes an unclaimed swap claimable, so its absence
            // belongs beside the row rather than in a footnote.
            entry.status === 'swapped' && !entry.hasHandle
              ? entry.claimSearched
                ? 'never claimed'
                : 'no handle'
              : '',
          ])
          // Sized to the contents so symbols and 18-decimal amounts do not wrap into
          // each other; numeric columns right-aligned to make magnitudes comparable.
          const widths = header.map((label, column) =>
            Math.max(label.length, ...rows.map((row) => row[column]!.length)),
          )
          const rightAligned = new Set([0, 2, 3, 4])
          const line = (cells: string[]) =>
            '  ' +
            cells
              .map((cell, column) =>
                rightAligned.has(column) ? cell.padStart(widths[column]!) : cell.padEnd(widths[column]!),
              )
              .join('  ')
              .trimEnd()
          console.log(line(header))
          console.log('  ' + widths.map((width) => '─'.repeat(width)).join('  '))
          for (const row of rows) console.log(line(row))
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
        if (data.walkedEverything) {
          // The whole history was searched and no claim names them, so they were
          // never claimed. Their proceeds may still be sitting in `swap_outputs`,
          // and a claim needs the whole handle — which chain history does not carry.
          warn(
            'The entire claim history was searched and none of them appear in it, so those swaps were ' +
              'never claimed. Their output may still be waiting on chain, but it cannot be claimed ' +
              'without the handle, which only the process that made the swap held.',
          )
        } else {
          warn(
            'Only part of the history was searched. Run `--reconcile` without --pages to walk all of it ' +
              'before concluding anything about these.',
          )
        }
      }
      if (!wantsClaim && data.owed.some((row) => row.claimable)) {
        console.log('\nRun with --claim --execute to collect.')
      }

      const { summary } = data
      console.log(`\nswaps settled: ${summary.settled}`)
      if (summary.settled) {
        for (const [pair, count] of Object.entries(summary.pairs).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${String(count).padStart(4)} × ${pair}`)
        }
        console.log('\nreceived in total:')
        for (const [tokenId, amount] of Object.entries(summary.received)) {
          const info = infoOf(tokenId)
          console.log(`  ${formatAmount(amount, info?.decimals ?? 0, info?.symbol ?? tokenId.slice(0, 10))}`)
        }
        for (const [tokenId, amount] of Object.entries(summary.refunded)) {
          const info = infoOf(tokenId)
          console.log(
            `  ${formatAmount(amount, info?.decimals ?? 0, info?.symbol ?? tokenId.slice(0, 10))} refunded unfilled`,
          )
        }
      }
      if (summary.unrecorded) {
        // Totals cover the swaps whose claim was found. Saying so keeps the figures
        // from reading as a complete account of the account's trading.
        console.log(
          `\nThese totals cover ${summary.settled} settled swap(s). ${summary.unrecorded} more were used ` +
            'on chain without a recorded claim, so their amounts are not included.',
        )
      }
      },
    )
  })
}
