/**
 * Collect — sweep what a position is owed into records the account holds.
 *
 * `collect` asks for explicit amounts and pays the withdrawal address fixed at
 * mint, so there is nothing to choose: the amounts come from chain. Two figures
 * matter and they are not the same one.
 *
 *   `tokens_owed0/1` in the positions mapping is what the contract has already
 *   booked — principal from an earlier decrease, plus fees settled at that time.
 *
 *   Fees earned since then are not booked yet. The finalize settles them before
 *   it checks the request, so they are collectable today; `getOwnedPosition`
 *   mirrors that settlement as `uncollectedFees0/1`. For a drained position the
 *   two figures are identical, because fee accrual scales with liquidity.
 *
 * So the request is the mirrored total, and `--booked-only` falls back to the
 * chain's booked figure alone for a caller who wants no estimate in the loop.
 *
 * `--close` burns the position afterwards. A burn needs zero liquidity and zero
 * owed, so it only applies to a position already drained with
 * `shield-swap liquidity --decrease --percent 100`.
 *
 * SPENDS REAL FUNDS with --execute. Without it, prints the plan and stops.
 *
 * Usage:
 *   shield-swap collect                                  # what every position is owed
 *   shield-swap collect --execute                        # collect from all of them
 *   shield-swap collect --position <id> --execute
 *   shield-swap collect --position <id> --close --execute # collect, then burn
 *   shield-swap collect --booked-only --execute
 */
import type { OwnedPosition, TokenInfo } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount, pollUntil } from '../session.js'
import { flags, step, done, warn, output, confirmed, run } from '../shared.js'

const USAGE = `shield-swap collect — withdraw a position's owed tokens, and optionally close it

  --position <id>               one position; omit for every owed position
  --close                       burn each position left fully drained
  --booked-only                 request only what the chain has already booked,
                                leaving fees accrued since the last operation
  --network <testnet|mainnet>   default testnet
  --execute                     actually submit
  --json                        machine-readable output

Payment goes to the withdrawal address fixed at mint, not to whoever runs this.`

/**
 * A position with something to sweep, and the two figures behind the request.
 *
 * @property booked0 What the positions mapping has already credited in token0.
 * @property booked1 Token1 counterpart of `booked0`.
 * @property request0 What this run asks for in token0 — the booked figure plus
 *   the fees the finalize settles first, unless `--booked-only`.
 * @property request1 Token1 counterpart of `request0`.
 * @property liquidity The position's live liquidity, which decides whether
 *   `--close` can burn it.
 */
type Owed = {
  position: OwnedPosition
  label: string
  token0: TokenInfo
  token1: TokenInfo
  booked0: bigint
  booked1: bigint
  request0: bigint
  request1: bigint
  liquidity: bigint
}

/**
 * Runs the `collect` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags(
    { position: { type: 'string' }, close: { type: 'boolean' }, 'booked-only': { type: 'boolean' } },
    USAGE,
    argv,
  )

  await run(async () => {
    const { client, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network}`)

    step('scanning position records and joining chain state')
    const owned = args.position
      ? await client
          .getOwnedPosition({ positionTokenId: args.position as string })
          .then((position) => (position ? [position] : []))
      : await client.getOwnedPositions()
    if (args.position && !owned.length) {
      throw new Error(
        `this account holds no position record for ${args.position as string} on ${network}. ` +
          'List what it does hold with `shield-swap positions`.',
      )
    }

    const tokens = await client.listTokens()
    const infoOf = (id: string) => tokens.find((token) => token.id === id)

    // What each position can actually be asked for, re-read per position: the scan
    // above can be seconds old by the time a proof lands, and a request above what
    // the finalize allows reverts and still costs a fee.
    const candidates: Owed[] = []
    for (const position of owned) {
      const token0 = infoOf(position.token0Id)
      const token1 = infoOf(position.token1Id)
      const label = `${token0?.symbol ?? '?'}/${token1?.symbol ?? '?'}`
      if (position.frozen) {
        warn(`skipping ${position.positionTokenId}: frozen, so a collect reverts until an admin unfreezes it`)
        continue
      }
      if (!position.state) {
        warn(
          `skipping ${position.positionTokenId}: no entry in the positions mapping — a mint still ` +
            'finalizing, or one already burned whose record the scanner still serves',
        )
        continue
      }
      if (!token0 || !token1) {
        warn(`skipping ${position.positionTokenId}: the registry does not describe both of its tokens`)
        continue
      }
      // Re-read the whole joined state, not just the mapping entry: the requested
      // figure below is the settlement mirror, which is derived from the position's
      // checkpoint AND the pool's live fee growth. Refreshing only `tokens_owed`
      // would leave the default path asking for a mirror computed at scan time,
      // which is exactly the stale read this guards against.
      const fresh = await client.getOwnedPosition({ positionTokenId: position.positionTokenId })
      const onchain = fresh?.state
      if (!onchain) {
        warn(`skipping ${position.positionTokenId}: its positions entry disappeared between the two reads`)
        continue
      }
      // Booked is what the chain has already credited; the default asks for the
      // mirror of the settlement the finalize performs first, which is never below
      // the booked figure.
      const request0 = args['booked-only'] ? onchain.tokensOwed0 : onchain.uncollectedFees0
      const request1 = args['booked-only'] ? onchain.tokensOwed1 : onchain.uncollectedFees1
      if (request0 === 0n && request1 === 0n) {
        // Warned rather than printed, so `--json` still emits exactly one object.
        if (args.position) {
          warn(
            `position ${position.positionTokenId} (${label}) is owed nothing. ` +
              (position.state.liquidity > 0n
                ? 'Withdraw some liquidity first with `shield-swap liquidity --position <id> --decrease --percent 100`.'
                : 'It is drained and swept — `--close` would burn it.'),
          )
        }
        continue
      }
      candidates.push({
        position,
        label,
        token0,
        token1,
        booked0: onchain.tokensOwed0,
        booked1: onchain.tokensOwed1,
        request0,
        request1,
        liquidity: onchain.liquidity,
      })
    }

    if (!candidates.length) {
      output({ network, submitted: false, collected: [], burned: [], failed: [] }, () => {
        console.log('\nNothing to collect. `shield-swap positions` shows what each position is owed.')
      })
      return
    }

    // One labelled row per fact, with the position id as the row that opens each
    // group: the label column carries the structure the indentation used to.
    const planLines: Array<readonly [string, string]> = []
    for (const entry of candidates) {
      planLines.push([entry.label, `${entry.position.positionTokenId.slice(0, 20)}…`])
      planLines.push([
        'take',
        `${formatAmount(entry.request0, entry.token0.decimals, entry.token0.symbol)} + ` +
          `${formatAmount(entry.request1, entry.token1.decimals, entry.token1.symbol)}`,
      ])
      const accrued0 = entry.request0 - entry.booked0
      const accrued1 = entry.request1 - entry.booked1
      if (accrued0 > 0n || accrued1 > 0n) {
        planLines.push([
          'of it',
          `${formatAmount(accrued0, entry.token0.decimals, entry.token0.symbol)} + ` +
            `${formatAmount(accrued1, entry.token1.decimals, entry.token1.symbol)} is fees earned since the ` +
            'last operation, which the finalize settles first',
        ])
      }
      planLines.push(['pays', entry.position.withdrawal])
      if (args.close) {
        planLines.push([
          'then',
          entry.liquidity === 0n
            ? 'burn the drained position'
            : `NOT burned — it still holds ${entry.liquidity} liquidity`,
        ])
      }
    }
    if (!confirmed({ execute: args.execute as boolean | undefined, network, plan: planLines })) {
      output(
        {
          network,
          submitted: false,
          positions: candidates.map((entry) => ({
            positionTokenId: entry.position.positionTokenId,
            poolKey: entry.position.poolKey,
            request0: entry.request0,
            request1: entry.request1,
            booked0: entry.booked0,
            booked1: entry.booked1,
            liquidity: entry.liquidity,
          })),
        },
        () => {},
      )
      return
    }

    // One imports map per pool rather than per position: it is a network read of
    // each token program's source, and positions in a pool share both tokens.
    const importsByPool = new Map<string, Record<string, string>>()
    const importsFor = async (entry: Owed) => {
      const cached = importsByPool.get(entry.position.poolKey)
      if (cached) return cached
      const resolved = await client.resolveDexImports({
        tokenPrograms: [entry.token0.ammTokenProgram, entry.token1.ammTokenProgram].filter(
          (program): program is string => !!program,
        ),
      })
      importsByPool.set(entry.position.poolKey, resolved)
      return resolved
    }

    const collected: Array<{ positionTokenId: string; transactionId: string; amount0: bigint; amount1: bigint }> = []
    const burned: Array<{ positionTokenId: string; transactionId: string }> = []
    const failed: Array<{ positionTokenId: string; error: string }> = []

    // Sequential: each collect spends and re-issues its position record, and the
    // proving time dwarfs any gain from overlapping them.
    for (const entry of candidates) {
      const id = entry.position.positionTokenId
      try {
        step(`collecting ${entry.label} from ${id.slice(0, 20)}… — this takes a minute or two`)
        const result = await client.collect({
          positionTokenId: id,
          poolKey: entry.position.poolKey,
          amount0Requested: entry.request0,
          amount1Requested: entry.request1,
          imports: await importsFor(entry),
        })
        done(
          `collected ${formatAmount(entry.request0, entry.token0.decimals, entry.token0.symbol)} + ` +
            `${formatAmount(entry.request1, entry.token1.decimals, entry.token1.symbol)} (tx ${result.transactionId})`,
        )
        collected.push({ positionTokenId: id, transactionId: result.transactionId, amount0: entry.request0, amount1: entry.request1 })

        // Mapping reads lag their writes, so the cleared balance is expected to
        // take a few seconds to show.
        const cleared = await pollUntil(
          async () => {
            const onchain = await client.getPosition({ positionTokenId: id })
            return !!onchain && onchain.tokens_owed0 === 0n && onchain.tokens_owed1 === 0n
          },
          10,
          3_000,
        )
        if (!cleared) {
          warn(
            'the position still shows an owed balance — either the mapping has not caught up, or fees ' +
              'accrued while this ran and are collectable on the next pass',
          )
        }

        if (!args.close) continue
        if (entry.liquidity > 0n) {
          warn(
            `not burning ${id.slice(0, 20)}…: a burn needs zero liquidity, and it holds ${entry.liquidity}. ` +
              'Drain it with `shield-swap liquidity --position <id> --decrease --percent 100` first.',
          )
          continue
        }
        if (!cleared) {
          warn(`not burning ${id.slice(0, 20)}…: a burn needs a zero owed balance, and this one is not zero yet`)
          continue
        }

        // The collect spent the position record and issued a new one. A burn built
        // on the spent record carries a serial number the chain has consumed, so
        // the node drops it at verification: it never reaches a block, and the only
        // symptom is a confirmation wait against a transaction nothing has heard
        // of. Presence is not enough — the spent record satisfies that too, so the
        // tag has to change.
        const staleTag = entry.position.record.tag
        step('waiting for the scanner to serve the position record the collect created')
        const indexed = await pollUntil(
          async () => {
            // The hosted scanner answers with intermittent 401s; a failed poll is
            // retried inside the window rather than ending the run.
            const current = await client.getOwnedPosition({ positionTokenId: id }).catch(() => null)
            return !!current && current.record.tag !== staleTag
          },
          30,
          2_000,
        )
        if (!indexed) {
          warn(
            `not burning ${id.slice(0, 20)}…: the scanner has not served the record the collect created ` +
              '(60s). Re-run with --close once it has — a burn against the spent record would be dropped.',
          )
          continue
        }

        step(`burning ${id.slice(0, 20)}…`)
        const burn = await client.burn({ positionTokenId: id, poolKey: entry.position.poolKey })
        done(`burned (tx ${burn.transactionId})`)
        burned.push({ positionTokenId: id, transactionId: burn.transactionId })
      } catch (error) {
        // One position's failure must not abandon the rest: each is a separate
        // transaction, and the others' proceeds are still there to be swept.
        const message = (error as Error).message
        warn(`${id.slice(0, 20)}… failed: ${message}`)
        failed.push({ positionTokenId: id, error: message })
      }
    }

    output(
      { network, submitted: true, collected, burned, failed },
      (data) => {
        console.log(`\nCollected from ${data.collected.length} of ${candidates.length} position(s).`)
        if (data.burned.length) console.log(`Burned ${data.burned.length} drained position(s).`)
        if (data.failed.length) {
          console.log(`${data.failed.length} failed — the amounts stay owed and can be swept again.`)
        }
        console.log('New balances: `shield-swap balances`.')
      },
    )
  })
}
