/**
 * Position discovery — every liquidity position the account holds, summarized.
 *
 * Discovered from the account's own records, not from a local list: each
 * position is a private NFT, and `getOwnedPositions` joins it with chain state
 * to report the range, the tokens currently backing it, and what `collect`
 * would pay right now.
 *
 * Only positions with an entry in the positions mapping are listed by default —
 * those are the ones that can be increased, decreased, collected from, or burned.
 * A record whose mapping entry is gone holds nothing and cannot be operated on;
 * `--all` lists those too, which is what to reach for when a mint seems missing.
 *
 * Reads only. Spends nothing.
 *
 * Usage:
 *   shield-swap positions                      # testnet, operable positions
 *   shield-swap positions --all                # include ones with no chain entry
 *   shield-swap positions --network mainnet
 *   shield-swap positions --pool <poolKey>     # one pool
 *   shield-swap positions --json
 */
import { loadSession, formatAmount } from '../session.js'
import { flags, step, done, warn, output, run, table } from '../shared.js'
import { dim, green, red, yellow } from '../color.js'

const USAGE = `shield-swap positions — owned liquidity positions and what they are owed

  --network <testnet|mainnet>   default testnet
  --pool <poolKey>              only positions in this pool
  --all                         include positions with no entry in the positions
                                mapping — a mint still finalizing, or one already
                                burned whose record the scanner still serves
  --json                        machine-readable output`

/**
 * Runs the `positions` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags({ pool: { type: 'string' }, all: { type: 'boolean' } }, USAGE, argv)

  await run(async () => {
    const { client, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network}`)

    step(
      args.all
        ? 'scanning unspent and spent position records, then joining chain state'
        : 'scanning position records and joining chain state',
    )
    const owned = await client.getOwnedPositions({
      ...(args.pool ? { poolKey: args.pool as string } : {}),
      // The spent scan is what proves a burn, so it is only worth its cost when
      // closed positions are going to be shown.
      ...(args.all ? { includeClosed: true } : {}),
    })
    const tokens = await client.listTokens()
    const infoOf = (id: string) => tokens.find((token) => token.id === id)

    const all = owned.map((position) => {
      const t0 = infoOf(position.token0Id)
      const t1 = infoOf(position.token1Id)
      return {
        positionTokenId: position.positionTokenId,
        poolKey: position.poolKey,
        pair: `${t0?.symbol ?? '?'}/${t1?.symbol ?? '?'}`,
        decimals0: t0?.decimals ?? 0,
        decimals1: t1?.decimals ?? 0,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        frozen: position.frozen,
        // A null state means the positions mapping has no entry, which happens at
        // both ends of a position's life: a mint that has not finalized, or one
        // already burned whose record the scanner is still serving. The two are
        // indistinguishable from here, so the label must not claim either.
        noChainEntry: position.state === null,
        // Proven from records, not inferred from the mapping's silence: the burn
        // consumed the last PositionNFT and re-issued nothing.
        closed: position.closed,
        // Left null rather than defaulted to zero. Everything above comes off the
        // record; these five come only from the positions mapping, and a zero here
        // would read as a drained position instead of one with nothing to read.
        state: position.state
          ? {
              liquidity: position.state.liquidity,
              amount0: position.state.amount0,
              amount1: position.state.amount1,
              collectable0: position.state.uncollectedFees0,
              collectable1: position.state.uncollectedFees1,
            }
          : null,
      }
    })

    // Hidden rather than dropped: the count is reported below so a position that
    // exists but cannot be operated on never reads as one the account never had.
    const hidden = args.all ? 0 : all.filter((row) => row.noChainEntry).length
    const rows = args.all ? all : all.filter((row) => !row.noChainEntry)
    const closed = all.filter((row) => row.closed).length

    output({ network, positions: rows, hidden, closed }, (data) => {
      if (!data.positions.length) {
        console.log(
          data.hidden
            ? `\nNo operable positions. ${data.hidden} record(s) have no entry in the positions ` +
                'mapping — pass --all to list them.'
            : '\nNo positions. Open one with `shield-swap mint --help`.',
        )
        return
      }
      table(
        ['PAIR', 'RANGE', 'LIQUIDITY', 'BACKING', 'COLLECTABLE', 'STATE', 'POSITION ID'],
        data.positions.map((row) => [
          row.pair,
          `${row.tickLower}…${row.tickUpper}`,
          // An em dash, not a zero: with no mapping entry there is no figure to
          // report, and printing 0 would be indistinguishable from a drained
          // position that still has one.
          row.state ? row.state.liquidity.toString() : dim('—'),
          // Both sides in one cell, in the pool's own token order: a position is
          // backed by a pair, and splitting them into four columns of bare numbers
          // loses which token each belongs to.
          row.state
            ? `${formatAmount(row.state.amount0, row.decimals0)} / ${formatAmount(row.state.amount1, row.decimals1)}`
            : dim('—'),
          row.state
            ? `${formatAmount(row.state.collectable0, row.decimals0)} / ${formatAmount(row.state.collectable1, row.decimals1)}`
            : dim('—'),
          // `closed` is proven, so it wins over the mapping's silence. Only a
          // record that is still unspent AND has no entry is genuinely undecided:
          // a mint mid-finalize, or a burn the scanner has not caught up with.
          row.closed
            ? dim('closed')
            : [row.frozen ? red('FROZEN') : '', row.noChainEntry ? yellow('pending') : '']
                .filter(Boolean)
                .join(', ') || green('open'),
          row.positionTokenId,
        ]),
        ['left', 'right', 'right', 'right', 'right', 'left', 'left'],
      )
      const owed = data.positions.filter(
        (row) => (row.state?.collectable0 ?? 0n) > 0n || (row.state?.collectable1 ?? 0n) > 0n,
      )
      if (owed.length) {
        console.log(`\n${owed.length} position(s) have something to collect — run \`shield-swap collect\`.`)
      }
      if (data.positions.some((row) => row.frozen)) {
        warn('a frozen position blocks every liquidity operation until an admin unfreezes it')
      }
      if (data.closed) console.log(`${data.closed} closed position(s) listed — burned, nothing left to operate on.`)
      // Only the undecided ones need the caveat now that burns are proven from
      // records: an unspent record with no mapping entry is a mint mid-finalize, or
      // a burn whose record the scanner has not marked spent yet.
      const pending = data.positions.filter((row) => row.noChainEntry && !row.closed).length
      if (pending || data.hidden) {
        warn(
          `${pending || data.hidden} position(s) hold an unspent record with no entry in the ` +
            'positions mapping — a mint still finalizing, or a burn the record scanner has not ' +
            'caught up with (it can serve a burned record for minutes). Neither can be operated on' +
            (data.hidden ? ', and they are not listed above — pass --all to see them.' : '.'),
        )
      }
    })
  })
}
