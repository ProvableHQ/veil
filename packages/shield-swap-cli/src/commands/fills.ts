/**
 * Position fills — what each pool swap did to the tokens backing a position.
 *
 * A concentrated position's liquidity is fixed, but the tokens that represent it
 * change as price moves: a swap that pushes price up through the range sells the
 * position's token0 for token1. This command reconstructs those changes, one row
 * per swap per position in chain order, from the position mapping, the indexer's
 * pool trade history, and the blocks that order it. Fills are inventory, not
 * earnings — for fees owed, see `shield-swap positions`.
 *
 * Positions are named with `--position` (repeatable) or discovered with `--all`,
 * which tracks every operable position the account owns. Positions in one pool
 * share its history read, so several cost little more than one.
 *
 * With `--watch` the replay is followed by a live feed: every new swap in a
 * tracked pool prints as the indexer records it. A position whose range or
 * liquidity changes drops out of the feed with a notice; the feed ends when
 * none remain.
 *
 * Reads only. Spends nothing.
 *
 * Usage:
 *   shield-swap fills --position <tokenId>                   # last 20 fills
 *   shield-swap fills --position <a> --position <b>          # several positions
 *   shield-swap fills --all                                  # every owned position
 *   shield-swap fills --position <tokenId> --history 50
 *   shield-swap fills --position <tokenId> --from-block 19400000
 *   shield-swap fills --position <tokenId> --watch           # replay, then stream
 *   shield-swap fills --position <tokenId> --network mainnet
 *   shield-swap fills --position <tokenId> --json            # one object; with
 *                                                            # --watch, one per line
 */
import { PositionTrackingError, type PositionFill, type PositionFillsSnapshot } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from '../session.js'
import { flags, step, done, warn, output, run, fail, table } from '../shared.js'
import { dim, red } from '../color.js'

const USAGE = `shield-swap fills — positions' swap fills, replayed and optionally streamed

  --position <tokenId>          a position's token id; repeat for several
  --all                         every operable position the account owns
                                (needs record access)
  --history <n>                 recent fills per pool to reconstruct, default 20
  --from-block <height>         every fill from this block onward instead
  --watch                       keep running and print each new fill as it lands
  --network <testnet|mainnet>   default testnet
  --json                        machine-readable output; with --watch, one
                                object per line`

/**
 * Formats a signed base-unit delta with the token's decimals.
 *
 * `formatAmount` handles magnitudes only: bigint division truncates toward
 * zero, so a negative amount below one whole unit would print as `0`.
 */
function signed(amount: bigint, decimals: number): string {
  if (amount === 0n) return '0'
  return `${amount < 0n ? '-' : '+'}${formatAmount(amount < 0n ? -amount : amount, decimals)}`
}

/** Shortens a field literal for a table cell; ids are long and mostly identical. */
const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-8)}`

/** Reads a non-negative integer flag, or exits naming the flag. */
function count(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) fail(`${flag} takes a whole number, got "${value}".`)
  return parsed
}

/**
 * Runs the `fills` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags(
    {
      position: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      history: { type: 'string' },
      'from-block': { type: 'string' },
      watch: { type: 'boolean' },
    },
    USAGE,
    argv,
  )
  // Collapsed here as the SDK collapses them, so the per-position accounting
  // below matches the errors the watch actually emits.
  const named = [...new Set((args.position as string[] | undefined) ?? [])]
  if (!named.length && !args.all) fail('name a position with --position, or pass --all to track every owned position.')
  const history = count(args.history, '--history')
  const fromBlock = count(args['from-block'], '--from-block')
  if (history !== undefined && fromBlock !== undefined) fail('--history and --from-block select the window two ways; pass one.')

  await run(async () => {
    const { client, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network}`)

    // --all discovers from records; --position names them directly. Both may be
    // given, in which case the union is tracked.
    let positionTokenIds = [...named]
    if (args.all) {
      step('scanning position records for operable positions')
      const owned = await client.getOwnedPositions()
      const operable = owned.filter((position) => position.state !== null).map((position) => position.positionTokenId)
      if (!operable.length && !named.length) {
        console.log('\nNo operable positions to track. Open one with `shield-swap mint --help`.')
        return
      }
      positionTokenIds = [...new Set([...positionTokenIds, ...operable])]
      done(`${operable.length} owned position(s) found`)
    }

    // Token metadata per pool, so deltas print in each pool's own units.
    const tokens = await client.listTokens()
    const infoOf = (id: string) => tokens.find((token) => token.id === id)
    const poolUnits = new Map<string, { sym0: string; sym1: string; dec0: number; dec1: number }>()
    const unitsFor = async (poolKey: string) => {
      let units = poolUnits.get(poolKey)
      if (!units) {
        const pool = await client.getPool({ poolKey })
        const t0 = pool ? infoOf(pool.token0) : undefined
        const t1 = pool ? infoOf(pool.token1) : undefined
        units = { sym0: t0?.symbol ?? 'token0', sym1: t1?.symbol ?? 'token1', dec0: t0?.decimals ?? 0, dec1: t1?.decimals ?? 0 }
        poolUnits.set(poolKey, units)
      }
      return units
    }

    const describe = (fill: PositionFill) => {
      const units = poolUnits.get(fill.poolKey)!
      return {
        positionTokenId: fill.positionTokenId,
        poolKey: fill.poolKey,
        pair: `${units.sym0}/${units.sym1}`,
        tradeId: fill.tradeId,
        blockHeight: fill.blockHeight,
        transactionId: fill.transactionId,
        transitionId: fill.transitionId,
        legIndex: fill.legIndex,
        // The trader's direction: zeroForOne means token0 was sold into the
        // pool, so the position's token0 inventory rose and its token1 fell.
        direction: fill.zeroForOne ? `${units.sym0}→${units.sym1}` : `${units.sym1}→${units.sym0}`,
        tickBefore: fill.tickBefore,
        tickAfter: fill.tickAfter,
        sqrtPriceBeforeX128: fill.sqrtPriceBeforeX128,
        sqrtPriceAfterX128: fill.sqrtPriceAfterX128,
        delta0: fill.amount0After - fill.amount0Before,
        delta1: fill.amount1After - fill.amount1Before,
        amount0After: fill.amount0After,
        amount1After: fill.amount1After,
        units,
      }
    }
    type Row = ReturnType<typeof describe>
    const cells = (row: Row) => [
      short(row.positionTokenId),
      row.pair,
      String(row.blockHeight),
      `${row.tickBefore}→${row.tickAfter}`,
      row.direction,
      `${signed(row.delta0, row.units.dec0)} / ${signed(row.delta1, row.units.dec1)}`,
      `${formatAmount(row.amount0After, row.units.dec0)} / ${formatAmount(row.amount1After, row.units.dec1)}`,
      row.transactionId,
    ]
    const headers = ['POSITION', 'PAIR', 'BLOCK', 'TICK', 'SWAP', 'Δ TOKEN0 / TOKEN1', 'BACKING AFTER', 'TX']
    const align = ['left', 'left', 'right', 'right', 'left', 'right', 'right', 'left'] as const
    // The start is known after a replay; the watch prints its headers before one.
    type Snapshot = Omit<PositionFillsSnapshot, 'start'> & { start?: PositionFillsSnapshot['start'] }
    const describeSnapshot = (snapshot: Snapshot) => {
      const units = poolUnits.get(snapshot.poolKey)!
      return {
        positionTokenId: snapshot.positionTokenId,
        poolKey: snapshot.poolKey,
        pair: `${units.sym0}/${units.sym1}`,
        tickLower: snapshot.tickLower,
        tickUpper: snapshot.tickUpper,
        liquidity: snapshot.liquidity,
        ...(snapshot.start ? { start: snapshot.start } : {}),
      }
    }
    const printSnapshots = (snapshots: ReturnType<typeof describeSnapshot>[]) => {
      console.log('')
      for (const snapshot of snapshots) {
        const start = snapshot.start
          ? `, measured from tick ${snapshot.start.tick}` + (snapshot.start.tradeId ? '' : ' (the live slot — no indexed swaps yet)')
          : ''
        console.log(
          `${snapshot.pair} position ${snapshot.positionTokenId}\n  range ${snapshot.tickLower}…${snapshot.tickUpper}, ` +
            `liquidity ${snapshot.liquidity}${start}`,
        )
      }
    }
    const window = fromBlock !== undefined ? `every fill since block ${fromBlock}` : `the last ${history ?? 20} fills per pool`
    const json = (value: unknown) =>
      JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))

    if (!args.watch) {
      step(`reconstructing ${window} for ${positionTokenIds.length} position(s) from indexed pool trades and their blocks`)
      const result = await client.getPositionFills({ positionTokenIds, history, fromBlock })
      await Promise.all(result.positions.map((position) => unitsFor(position.poolKey)))
      const snapshots = result.positions.map(describeSnapshot)
      output(
        { network, positions: snapshots, fills: result.fills.map(describe).map(({ units: _units, ...row }) => row) },
        (data) => {
          printSnapshots(data.positions)
          if (!data.fills.length) {
            console.log('\nNo fills in the window. Pass --watch to wait for the next swap.')
            return
          }
          table(headers, result.fills.map(describe).map(cells), align)
          console.log(dim('\nDeltas are inventory changes at fixed liquidity, not fees earned.'))
        },
      )
      return
    }

    // Watch mode streams: a human sees each position's header once and one
    // line per fill, an agent under --json gets one object per line. Neither is
    // the single object `output` prints, so both branches write directly.
    const snapshots = await Promise.all(
      positionTokenIds.map(async (positionTokenId) => {
        const position = await client.getPosition({ positionTokenId })
        if (!position) return undefined
        await unitsFor(position.pool)
        return { positionTokenId, poolKey: position.pool, tickLower: position.tick_lower, tickUpper: position.tick_upper, liquidity: position.liquidity }
      }),
    )
    if (!args.json) {
      printSnapshots(snapshots.filter((snapshot) => snapshot !== undefined).map(describeSnapshot))
      step(`replaying ${window}, then following the pool(s) live (ctrl-c to stop)`)
    }
    const emit = (fill: PositionFill, replayed: boolean) => {
      const { units, ...row } = describe(fill)
      if (args.json) {
        console.log(json({ ...row, replayed }))
        return
      }
      // Labeled rather than tabulated: a stream has no final row to size
      // columns against, and the replayed rows are dimmed as context.
      const line =
        `  ${short(row.positionTokenId)}  ${row.pair}  block ${row.blockHeight}  tick ${row.tickBefore}→${row.tickAfter}  ` +
        `${row.direction}  ${signed(row.delta0, units.dec0)} ${units.sym0}  ${signed(row.delta1, units.dec1)} ${units.sym1}  ${row.transactionId}`
      console.log(replayed ? dim(line) : line)
    }

    await new Promise<void>((resolve) => {
      let remaining = positionTokenIds.length
      const stop = client.watchPositionFills({
        positionTokenIds,
        history,
        fromBlock,
        onFill: (fill, { replayed }) => emit(fill, replayed),
        onError: (error) => {
          if (error instanceof PositionTrackingError) {
            // The watch has already dropped these positions; the exit code
            // records that the feed did not end by choice.
            remaining -= error.positionTokenIds.length
            if (args.json) console.log(json({ error: { message: error.message, positionTokenIds: error.positionTokenIds } }))
            else console.error(`\n${red('✗', 'stderr')} ${error.message}`)
            process.exitCode = 1
            if (remaining <= 0) resolve()
            return
          }
          warn(`${error.message} — retrying on the next poll`)
        },
      })
      process.once('SIGINT', () => {
        stop()
        resolve()
      })
    })
  })
}
