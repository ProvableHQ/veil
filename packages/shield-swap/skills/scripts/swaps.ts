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
 *   npx tsx swaps.ts                              # what is owed
 *   npx tsx swaps.ts --claim --execute            # claim everything claimable
 *   npx tsx swaps.ts --claim <swapId> --execute   # claim one
 *   npx tsx swaps.ts --reconcile                  # rebuild from chain history
 *   npx tsx swaps.ts --json
 */
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from './session.js'
import { flags, setJsonMode, step, done, warn, output, confirmed, run } from './cli.js'

const USAGE = `swaps.ts — unclaimed swap outputs, reconciliation, and claiming

  --network <testnet|mainnet>   default testnet
  --claim [swapId]              claim one or (with no value) everything claimable
  --reconcile                   recover lost swap ids from chain history
  --pages <n>                   history pages for --reconcile, default 8
  --execute                     actually submit claims
  --json                        machine-readable output`

const args = flags(
  { claim: { type: 'string' }, reconcile: { type: 'boolean' }, pages: { type: 'string' } },
  USAGE,
)
setJsonMode(!!args.json)
// `--claim` with no value parses as an empty string, which means "all".
const claimAll = args.claim === ''
const claimOne = typeof args.claim === 'string' && args.claim !== '' ? args.claim : undefined
const wantsClaim = claimAll || !!claimOne

await run(async () => {
  const { client, network, blindedIdentities } = await loadSession({
    network: args.network as string | undefined,
  })
  done(`session on ${network}`)
  // How many identities the store holds at all, so an empty store can be
  // reported as "nothing tracked" rather than "nothing owed" — they mean very
  // different things to someone looking for missing funds.
  const tracked = (await blindedIdentities.load()).length

  if (args.reconcile) {
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

  step('reading swap_outputs for every identity the store knows')
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

  output(
    { network, tracked, owed: rows, totals: owed.totals, unresolvable: owed.unresolvable.length, claimed },
    (data) => {
    if (!data.owed.length) {
      console.log(
        data.tracked === 0
          ? '\nThis store tracks no identities yet, so there is nothing to look for. A swap made ' +
              'through these scripts records itself; a swap made elsewhere is invisible here.'
          : `\nNothing owed across ${data.tracked} tracked identity(ies) — all settled.`,
      )
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
        `${data.unresolvable} consumed identity(ies) have no swap id — their proceeds cannot be located ` +
          'until something claims them. --reconcile recovers ids for ones already claimed.',
      )
    }
    if (!wantsClaim && data.owed.some((row) => row.claimable)) {
      console.log('\nRun with --claim --execute to collect.')
    }
    },
  )
})
