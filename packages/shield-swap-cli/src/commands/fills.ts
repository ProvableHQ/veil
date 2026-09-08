/**
 * Position fills — what each pool swap did to the tokens backing a position.
 *
 * A concentrated position's liquidity is fixed, but the tokens that represent it
 * change as price moves: a swap that pushes price up through the range sells the
 * position's token0 for token1. This command reconstructs those changes, one row
 * per swap in chain order, from the position mapping, the indexer's pool trade
 * history, and the blocks that order it. Fills are inventory, not earnings — for
 * fees owed, see `shield-swap positions`.
 *
 * With `--watch` the replay is followed by a live feed: every new swap in the pool
 * prints as the indexer records it, until the position's range or liquidity
 * changes, at which point the feed stops and says so.
 *
 * Reads only. Spends nothing.
 *
 * Usage:
 *   shield-swap fills --position <tokenId>                 # last 20 fills
 *   shield-swap fills --position <tokenId> --history 50
 *   shield-swap fills --position <tokenId> --watch         # replay, then stream
 *   shield-swap fills --position <tokenId> --network mainnet
 *   shield-swap fills --position <tokenId> --json          # one object; with
 *                                                          # --watch, one per line
 */
import { PositionTrackingError, type PositionFill } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from '../session.js'
import { flags, step, done, warn, output, run, fail, table } from '../shared.js'
import { dim, red } from '../color.js'

const USAGE = `shield-swap fills — a position's swap fills, replayed and optionally streamed

  --position <tokenId>          the position's token id (required)
  --history <n>                 recent fills to reconstruct, default 20
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

/**
 * Runs the `fills` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags({ position: { type: 'string' }, history: { type: 'string' }, watch: { type: 'boolean' } }, USAGE, argv)
  const positionTokenId = args.position as string | undefined
  if (!positionTokenId) fail('--position is required: the token id of the position to track.')
  const history = args.history === undefined ? undefined : Number(args.history)
  if (history !== undefined && (!Number.isInteger(history) || history < 0)) {
    fail(`--history takes a whole number of fills, got "${args.history}".`)
  }

  await run(async () => {
    const { client, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network}`)

    // Token metadata for the two sides, so deltas print in the pool's own units.
    const position = await client.getPosition({ positionTokenId })
    if (!position) throw new Error(`position ${positionTokenId} does not exist on chain.`)
    const [pool, tokens] = await Promise.all([client.getPool({ poolKey: position.pool }), client.listTokens()])
    const infoOf = (id: string) => tokens.find((token) => token.id === id)
    const t0 = pool ? infoOf(pool.token0) : undefined
    const t1 = pool ? infoOf(pool.token1) : undefined
    const sym0 = t0?.symbol ?? 'token0'
    const sym1 = t1?.symbol ?? 'token1'
    const dec0 = t0?.decimals ?? 0
    const dec1 = t1?.decimals ?? 0

    const describe = (fill: PositionFill) => ({
      tradeId: fill.tradeId,
      blockHeight: fill.blockHeight,
      transactionId: fill.transactionId,
      transitionId: fill.transitionId,
      legIndex: fill.legIndex,
      // Named from the position's side: the pool selling token0 means the
      // position's token0 inventory fell and its token1 inventory rose.
      direction: fill.zeroForOne ? `${sym1}→${sym0}` : `${sym0}→${sym1}`,
      tickBefore: fill.tickBefore,
      tickAfter: fill.tickAfter,
      sqrtPriceBeforeX128: fill.sqrtPriceBeforeX128,
      sqrtPriceAfterX128: fill.sqrtPriceAfterX128,
      delta0: fill.amount0After - fill.amount0Before,
      delta1: fill.amount1After - fill.amount1Before,
      amount0After: fill.amount0After,
      amount1After: fill.amount1After,
    })
    type Row = ReturnType<typeof describe>
    const cells = (row: Row) => [
      String(row.blockHeight),
      `${row.tickBefore}→${row.tickAfter}`,
      row.direction,
      signed(row.delta0, dec0),
      signed(row.delta1, dec1),
      `${formatAmount(row.amount0After, dec0)} / ${formatAmount(row.amount1After, dec1)}`,
      row.transactionId,
    ]
    const headers = ['BLOCK', 'TICK', 'POOL SOLD', `Δ ${sym0}`, `Δ ${sym1}`, 'BACKING AFTER', 'TX']
    const align = ['right', 'right', 'left', 'right', 'right', 'right', 'left'] as const
    const summary = {
      network,
      positionTokenId,
      poolKey: position.pool,
      pair: `${sym0}/${sym1}`,
      tickLower: position.tick_lower,
      tickUpper: position.tick_upper,
      liquidity: position.liquidity,
    }

    if (!args.watch) {
      step(`reconstructing the last ${history ?? 20} fills from indexed pool trades and their blocks`)
      const result = await client.getPositionFills({ positionTokenId, history })
      output({ ...summary, start: result.start, fills: result.fills.map(describe) }, (data) => {
        console.log(
          `\n${data.pair} position ${data.positionTokenId}\n  range ${data.tickLower}…${data.tickUpper}, ` +
            `liquidity ${data.liquidity}, measured from tick ${data.start.tick}` +
            (data.start.tradeId ? '' : ' (the live slot — no indexed swaps yet)'),
        )
        if (!data.fills.length) {
          console.log('\nNo fills: the pool has at most one indexed swap. Pass --watch to wait for the next.')
          return
        }
        table(headers, data.fills.map(cells), align)
        console.log(dim('\nDeltas are inventory changes at fixed liquidity, not fees earned.'))
      })
      return
    }

    // Watch mode streams: a human sees the header once and one line per fill,
    // an agent under --json gets one object per line. Neither is the single
    // object `output` prints, so both branches write directly.
    if (!args.json) {
      console.log(
        `\n${summary.pair} position ${positionTokenId}\n  range ${summary.tickLower}…${summary.tickUpper}, ` +
          `liquidity ${summary.liquidity}`,
      )
      step(`replaying the last ${history ?? 20} fills, then following the pool live (ctrl-c to stop)`)
    }
    const emit = (fill: PositionFill, replayed: boolean) => {
      const row = describe(fill)
      if (args.json) {
        console.log(JSON.stringify({ ...row, replayed }, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
        return
      }
      // Labeled rather than tabulated: a stream has no final row to size
      // columns against, and the replayed rows are dimmed as context.
      const line =
        `  block ${row.blockHeight}  tick ${row.tickBefore}→${row.tickAfter}  ${row.direction}  ` +
        `${signed(row.delta0, dec0)} ${sym0}  ${signed(row.delta1, dec1)} ${sym1}  ${row.transactionId}`
      console.log(replayed ? dim(line) : line)
    }

    await new Promise<void>((resolve) => {
      const stop = client.watchPositionFills({
        positionTokenId,
        history,
        onFill: (fill, { replayed }) => emit(fill, replayed),
        onError: (error) => {
          if (error instanceof PositionTrackingError) {
            // The watch has already stopped itself; the exit code says so.
            if (args.json) console.log(JSON.stringify({ error: { message: error.message } }))
            else console.error(`\n${red('✗', 'stderr')} ${error.message}`)
            process.exitCode = 1
            resolve()
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
